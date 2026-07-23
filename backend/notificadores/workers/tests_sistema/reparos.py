# -*- coding: utf-8 -*-
import os
import time
import glob as _glob
from .config import (
    logger, REDIS_MAXMEMORY, LOG_DIR, BASE_DIR,
    DISK_LOG_RETENCAO_D, DB_IDLE_TRANS_MIN,
)


def executar_reparos(resultados, conn, redis_client):
    """
    Tenta reparar automaticamente problemas identificados.
    Retorna lista de (item, sucesso, detalhe).
    """
    reparos   = []
    problemas = [r for r in resultados if r['reparavel']]

    if not problemas:
        return reparos

    nomes = {p['item'] for p in problemas}

    # Redis: maxmemory e policy
    if redis_client:
        if 'Redis maxmemory' in nomes:
            try:
                redis_client.config_set('maxmemory', REDIS_MAXMEMORY)
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis maxmemory', True,
                    'Configurado {} com policy allkeys-lru'.format(REDIS_MAXMEMORY)))
                logger.info('[reparo] Redis maxmemory: %s allkeys-lru', REDIS_MAXMEMORY)
            except Exception as e:
                reparos.append(('Redis maxmemory', False, str(e)))

        if 'Redis eviction policy' in nomes:
            try:
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis eviction policy', True, 'Definida como allkeys-lru'))
                logger.info('[reparo] Redis policy: allkeys-lru')
            except Exception as e:
                reparos.append(('Redis eviction policy', False, str(e)))

    # Disco: limpar logs antigos
    if any('Disco' in p['item'] for p in problemas):
        try:
            cutoff   = time.time() - DISK_LOG_RETENCAO_D * 86400
            removidos = []
            for f in _glob.glob(os.path.join(LOG_DIR, '*.log.*')):
                try:
                    if os.path.getmtime(f) < cutoff:
                        os.remove(f)
                        removidos.append(os.path.basename(f))
                except Exception:
                    pass
            # Logs de crash Python raiz — nunca remove logs principais
            for f in _glob.glob(os.path.join(BASE_DIR, '*.log')):
                try:
                    if os.path.getmtime(f) < cutoff and os.path.getsize(f) < 1024:
                        pass
                except Exception:
                    pass
            if removidos:
                reparos.append(('Disco', True,
                    'Removidos {} log(s) antigo(s) (>{} dias): {}'.format(
                        len(removidos), DISK_LOG_RETENCAO_D,
                        ', '.join(removidos[:5]) + ('...' if len(removidos) > 5 else ''))))
                logger.info('[reparo] Disco: removidos %d logs antigos', len(removidos))
            else:
                reparos.append(('Disco', False,
                    'Nenhum log antigo encontrado para limpeza (>{} dias)'.format(
                        DISK_LOG_RETENCAO_D)))
        except Exception as e:
            reparos.append(('Disco', False, 'Erro ao limpar logs: {}'.format(e)))

    if conn:
        cursor = conn.cursor()

        # Idle in transaction: encerra sessões travadas
        if 'Idle in transaction' in nomes:
            try:
                cursor.execute("""
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE state = 'idle in transaction'
                      AND xact_start IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60 > %s
                      AND pid <> pg_backend_pid()
                """, (DB_IDLE_TRANS_MIN,))
                n = cursor.rowcount
                conn.commit()
                reparos.append(('Idle in transaction', True,
                    '{} sessão(ões) travada(s) encerrada(s)'.format(n)))
                logger.info('[reparo] Idle-in-transaction: %d sessão(ões) encerrada(s)', n)
            except Exception as e:
                conn.rollback()
                reparos.append(('Idle in transaction', False, str(e)))

        # notificacoes_log.topico_ntfy NOT NULL
        if any('topico_ntfy' in p['item'] for p in problemas):
            try:
                cursor.execute("""
                    ALTER TABLE notificacoes_log
                    ALTER COLUMN topico_ntfy DROP NOT NULL
                """)
                conn.commit()
                reparos.append(('notificacoes_log.topico_ntfy nullable', True,
                    'Constraint NOT NULL removida'))
                logger.info('[reparo] topico_ntfy: NOT NULL removido')
            except Exception as e:
                conn.rollback()
                reparos.append(('notificacoes_log.topico_ntfy nullable', False, str(e)))

        # Colunas criado_em ausentes
        for tabela in ('historico_usuarios', 'permissoes_paineis', 'usuarios'):
            chave = '{}.criado_em presente'.format(tabela)
            if chave in nomes:
                try:
                    cursor.execute("""
                        ALTER TABLE {} ADD COLUMN IF NOT EXISTS criado_em
                        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """.format(tabela))
                    conn.commit()
                    reparos.append((chave, True, 'criado_em adicionada em {}'.format(tabela)))
                    logger.info('[reparo] criado_em adicionada em %s', tabela)
                except Exception as e:
                    conn.rollback()
                    reparos.append((chave, False, str(e)))

        # tipo_evento paciente_ps_sem_medico
        if 'Paciente PS Sem Médico tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'paciente_ps_sem_medico',
                        'Paciente PS Sem Médico',
                        'Alerta quando há paciente aguardando mais de 10 minutos sem médico no PS',
                        'fa-user-clock', '#dc3545', 'painel_ps_analise', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento
                        WHERE codigo = 'paciente_ps_sem_medico'
                    )
                """)
                conn.commit()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', True,
                    'Tipo de evento inserido'))
                logger.info('[reparo] tipo_evento paciente_ps_sem_medico inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', False, str(e)))

        # tipo_evento parecer_pendente
        if 'Pareceres Pendentes tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'parecer_pendente', 'Parecer Pendente',
                        'Alerta de parecer médico aguardando resposta',
                        'fa-file-medical', '#0d6efd', 'pareceres_pendentes', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento
                        WHERE codigo = 'parecer_pendente'
                    )
                """)
                conn.commit()
                reparos.append(('Pareceres Pendentes tipo cadastrado', True, 'Tipo inserido'))
                logger.info('[reparo] tipo_evento parecer_pendente inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Pareceres Pendentes tipo cadastrado', False, str(e)))

        cursor.close()

    return reparos
