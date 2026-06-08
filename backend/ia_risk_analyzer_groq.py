#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Worker de Análise Clínica IA - VERSÃO MELHORADA
✅ Persistência de análises
✅ Hash para detectar mudanças
✅ Evita reprocessamento desnecessário
"""

import os
import sys
import time
import hashlib
from datetime import datetime
from typing import Dict, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv('GROQ_API_KEY')
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# ✅ CONFIGURAÇÕES
MAX_CICLOS = 10  # Número de ciclos antes de parar
INTERVALO_ANALISE = 300000  # 5 minutos entre ciclos
BATCH_SIZE = 30  # Pacientes por ciclo
MAX_TOKENS = 2000  # Tokens máximos da resposta IA
HORAS_VALIDADE_ANALISE = 24  # Análise válida por 24 horas

if not GROQ_API_KEY:
    print("❌ ERRO: GROQ_API_KEY não configurada no .env")
    sys.exit(1)


class ClinicalAIAnalyzer:
    """
    Analisador Clínico com IA
    - Persistência inteligente de análises
    - Hash para detectar mudanças nos dados
    - Evita reprocessamento desnecessário
    """

    def __init__(self):
        self.client = Groq(api_key=GROQ_API_KEY)
        self.modelo = "llama-3.3-70b-versatile"
        self.ciclo_atual = 0
        print(f"✅ Cliente Groq inicializado: {self.modelo}")
        print(f"⏱️  Limite: {MAX_CICLOS} ciclos")
        print(f"🔄 Intervalo: {INTERVALO_ANALISE}s")

    def get_db_connection(self):
        """Cria conexão com PostgreSQL"""
        try:
            conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD
            )
            return conn
        except Exception as e:
            print(f"❌ Erro ao conectar DB: {e}")
            return None

    def calcular_hash_dados(self, dados: Dict) -> str:
        """
        Calcula hash MD5 dos dados clínicos principais
        Usado para detectar se dados mudaram
        """
        campos_relevantes = [
            str(dados.get('qt_pa_sistolica', '')),
            str(dados.get('qt_pa_diastolica', '')),
            str(dados.get('qt_freq_cardiaca', '')),
            str(dados.get('qt_freq_resp', '')),
            str(dados.get('qt_saturacao_o2', '')),
            str(dados.get('exm_creatinina', '')),
            str(dados.get('exm_sodio', '')),
            str(dados.get('exm_potassio', '')),
            str(dados.get('exm_lactato_art', '')),
            str(dados.get('exm_lactato_ven', '')),
            str(dados.get('exm_troponina', '')),
            str(dados.get('exm_hemoglobina', '')),
        ]

        string_para_hash = '|'.join(campos_relevantes)
        return hashlib.md5(string_para_hash.encode()).hexdigest()

    def buscar_pacientes_para_analise(self) -> List[Dict]:
        """
        Busca pacientes que REALMENTE precisam de análise:
        1. Nunca foram analisados
        2. Dados clínicos mudaram (hash diferente)
        3. Análise tem mais de 24 horas

        ✅ PROTEÇÃO: Só busca pacientes que existem no painel
        """
        conn = self.get_db_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            query = """
                SELECT 
                    p.nr_atendimento,
                    p.nm_pessoa_fisica,
                    p.cd_unidade,
                    p.nm_setor,
                    p.qt_pa_sistolica,
                    p.qt_pa_diastolica,
                    p.qt_freq_cardiaca,
                    p.qt_freq_resp,
                    p.qt_saturacao_o2,
                    p.qt_temp,
                    p.exm_creatinina,
                    p.exm_ureia,
                    p.exm_sodio,
                    p.exm_potassio,
                    p.exm_leucocitos,
                    p.exm_lactato_art,
                    p.exm_lactato_ven,
                    p.exm_troponina,
                    p.exm_hemoglobina,
                    ia.dt_analise AS ultima_analise,
                    ia.hash_dados AS hash_anterior
                FROM 
                    public.painel_clinico_tasy p
                    LEFT JOIN public.painel_clinico_analise_ia ia
                        ON p.nr_atendimento = ia.nr_atendimento
                        AND COALESCE(ia.ie_ativo, TRUE) = TRUE
                WHERE 
                    p.ie_status_unidade = 'P'
                    AND (
                        -- Nunca foi analisado
                        ia.nr_atendimento IS NULL
                        OR
                        -- Análise tem mais de 24 horas
                        EXTRACT(EPOCH FROM (NOW() - ia.dt_analise)) / 3600 > %s
                    )
                ORDER BY 
                    -- Prioriza pacientes sem análise
                    CASE WHEN ia.nr_atendimento IS NULL THEN 0 ELSE 1 END,
                    p.dt_carga DESC
                LIMIT %s
            """

            cursor.execute(query, (HORAS_VALIDADE_ANALISE, BATCH_SIZE))
            pacientes = cursor.fetchall()
            cursor.close()
            conn.close()

            return [dict(p) for p in pacientes]

        except Exception as e:
            print(f"❌ Erro ao buscar pacientes: {e}")
            if conn:
                conn.close()
            return []

    def formatar_contexto_clinico(self, paciente: Dict) -> str:
        """
        Formata dados clínicos anonimizados para análise IA.
        LGPD: nm_pessoa_fisica, nr_atendimento e cd_unidade (leito) são OMITIDOS —
        identificam o paciente diretamente e não devem trafegar para serviços externos.
        Apenas indicadores clínicos numéricos e o setor (dado operacional) são enviados.
        """

        # Helper para formatar valores
        def fmt(valor, unidade=''):
            if valor is None or str(valor).upper() == 'NA':
                return 'não disponível'
            return f"{valor} {unidade}".strip()

        return f"""
SETOR: {paciente.get('nm_setor', 'N/A')}

🫀 SINAIS VITAIS:
- Pressão Arterial: {fmt(paciente.get('qt_pa_sistolica'))}/{fmt(paciente.get('qt_pa_diastolica'))} mmHg
- Frequência Cardíaca: {fmt(paciente.get('qt_freq_cardiaca'), 'bpm')}
- Frequência Respiratória: {fmt(paciente.get('qt_freq_resp'), 'irpm')}
- Saturação O2: {fmt(paciente.get('qt_saturacao_o2'), '%')}
- Temperatura: {fmt(paciente.get('qt_temp'), '°C')}

🧪 EXAMES LABORATORIAIS:
- Creatinina: {fmt(paciente.get('exm_creatinina'), 'mg/dL')}
- Ureia: {fmt(paciente.get('exm_ureia'), 'mg/dL')}
- Sódio: {fmt(paciente.get('exm_sodio'), 'mEq/L')}
- Potássio: {fmt(paciente.get('exm_potassio'), 'mEq/L')}
- Leucócitos: {fmt(paciente.get('exm_leucocitos'), 'mil/mm³')}
- Hemoglobina: {fmt(paciente.get('exm_hemoglobina'), 'g/dL')}
- Lactato: {fmt(paciente.get('exm_lactato_art') or paciente.get('exm_lactato_ven'), 'mmol/L')}
- Troponina: {fmt(paciente.get('exm_troponina'), 'ng/mL')}
"""

    def analisar_paciente(self, paciente: Dict) -> Optional[Dict]:
        """
        Realiza análise clínica usando IA
        Retorna dict com análise ou None se erro
        """
        contexto = self.formatar_contexto_clinico(paciente)

        prompt = f"""Você é um médico intensivista experiente analisando pacientes em UTI/Enfermaria.

{contexto}

Analise o quadro clínico e forneça:

**CRITICIDADE:** [CRÍTICO / ALTO / MODERADO / BAIXO]

**PONTOS DE ATENÇÃO:**
• [Liste 2-3 pontos mais importantes]

**RECOMENDAÇÕES:**
• [Liste 2-3 ações prioritárias]

Seja conciso e objetivo. Foque nos achados mais relevantes."""

        try:
            inicio = time.time()

            response = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Você é um médico intensivista experiente. Suas análises são claras, objetivas e baseadas em evidências."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                model=self.modelo,
                temperature=0.3,
                max_tokens=MAX_TOKENS,
            )

            tempo_ms = int((time.time() - inicio) * 1000)
            analise_texto = response.choices[0].message.content

            # Extrai nível de criticidade da resposta
            criticidade = "MODERADO"  # Default
            analise_upper = analise_texto.upper()

            if "CRÍTICO" in analise_upper or "CRITICO" in analise_upper:
                criticidade = "CRÍTICO"
            elif "ALTO" in analise_upper:
                criticidade = "ALTO"
            elif "BAIXO" in analise_upper:
                criticidade = "BAIXO"

            # Mapeia criticidade para score
            score_map = {
                "CRÍTICO": 90,
                "ALTO": 70,
                "MODERADO": 50,
                "BAIXO": 30
            }

            return {
                'analise_ia': analise_texto,
                'nivel_criticidade': criticidade,
                'score_ia': score_map.get(criticidade, 50),
                'tempo_processamento_ms': tempo_ms,
                'hash_dados': self.calcular_hash_dados(paciente)
            }

        except Exception as e:
            print(f"❌ Erro na análise IA: {e}")
            return None

    def salvar_analise(self, nr_atendimento: int, paciente: Dict, analise: Dict) -> bool:
        """
        Salva análise no banco com hash
        Usa UPSERT para atualizar se já existe
        """
        conn = self.get_db_connection()
        if not conn:
            return False

        try:
            cursor = conn.cursor()

            query = """
                INSERT INTO public.painel_clinico_analise_ia (
                    nr_atendimento, 
                    nm_paciente, 
                    cd_leito, 
                    nm_setor,
                    analise_ia, 
                    nivel_criticidade, 
                    score_ia, 
                    modelo_ia,
                    tempo_processamento_ms, 
                    hash_dados,
                    ie_ativo
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (nr_atendimento) DO UPDATE SET
                    analise_ia = EXCLUDED.analise_ia,
                    nivel_criticidade = EXCLUDED.nivel_criticidade,
                    score_ia = EXCLUDED.score_ia,
                    hash_dados = EXCLUDED.hash_dados,
                    tempo_processamento_ms = EXCLUDED.tempo_processamento_ms,
                    dt_atualizacao = NOW(),
                    ie_ativo = TRUE
            """

            cursor.execute(query, (
                nr_atendimento,
                paciente.get('nm_pessoa_fisica'),
                paciente.get('cd_unidade'),
                paciente.get('nm_setor'),
                analise['analise_ia'],
                analise['nivel_criticidade'],
                analise['score_ia'],
                self.modelo,
                analise['tempo_processamento_ms'],
                analise['hash_dados']
            ))

            conn.commit()
            cursor.close()
            conn.close()
            return True

        except Exception as e:
            print(f"❌ Erro ao salvar análise: {e}")
            if conn:
                conn.rollback()
                conn.close()
            return False

    def arquivar_analises_antigas(self):
        """
        Marca como inativo análises de pacientes que:
        1. NÃO estão mais no painel (saíram)
        2. Análise tem mais de 24 horas

        ✅ PRESERVA o histórico - não apaga, só marca como inativo
        ✅ PROTEÇÃO: Trabalha sem foreign key, mantém dados históricos
        """
        conn = self.get_db_connection()
        if not conn:
            return

        try:
            cursor = conn.cursor()

            # Arquiva análises de pacientes que saíram do painel há >24h
            query_arquivar = """
                UPDATE public.painel_clinico_analise_ia ia
                SET 
                    ie_ativo = FALSE,
                    dt_atualizacao = NOW()
                WHERE 
                    COALESCE(ia.ie_ativo, TRUE) = TRUE
                    AND NOT EXISTS (
                        SELECT 1 
                        FROM public.painel_clinico_tasy p
                        WHERE 
                            p.nr_atendimento = ia.nr_atendimento
                            AND p.ie_status_unidade = 'P'
                    )
                    AND EXTRACT(EPOCH FROM (NOW() - ia.dt_analise)) / 3600 > %s
            """

            cursor.execute(query_arquivar, (HORAS_VALIDADE_ANALISE,))
            arquivados = cursor.rowcount

            if arquivados > 0:
                print(f"📦 {arquivados} análise(s) arquivada(s) (pacientes saíram há >24h)")

            # LIMPEZA OPCIONAL: Remove análises muito antigas (>30 dias inativas)
            # Descomente se quiser limpar histórico antigo
            """
            query_limpar = '''
                DELETE FROM public.painel_clinico_analise_ia
                WHERE 
                    ie_ativo = FALSE
                    AND EXTRACT(EPOCH FROM (NOW() - dt_atualizacao)) / 86400 > 30
            '''
            cursor.execute(query_limpar)
            removidos = cursor.rowcount
            if removidos > 0:
                print(f"🗑️  {removidos} análise(s) antigas removida(s) (>30 dias inativas)")
            """

            conn.commit()
            cursor.close()
            conn.close()

        except Exception as e:
            print(f"⚠️ Erro ao arquivar análises: {e}")
            if conn:
                conn.rollback()
                conn.close()

    def monitorar_analises_orfas(self):
        """
        Monitora análises de atendimentos que não existem mais no painel
        Útil para debug e estatísticas
        """
        conn = self.get_db_connection()
        if not conn:
            return

        try:
            cursor = conn.cursor()

            query = """
                SELECT 
                    COUNT(*) as total_orfas,
                    COUNT(*) FILTER (WHERE ie_ativo = TRUE) as orfas_ativas
                FROM public.painel_clinico_analise_ia ia
                WHERE NOT EXISTS (
                    SELECT 1 
                    FROM public.painel_clinico_tasy p
                    WHERE p.nr_atendimento = ia.nr_atendimento
                )
            """

            cursor.execute(query)
            resultado = cursor.fetchone()
            cursor.close()
            conn.close()

            if resultado and resultado[0] > 0:
                print(f"ℹ️  Análises órfãs: {resultado[0]} total ({resultado[1]} ativas)")

        except Exception as e:
            print(f"⚠️ Erro ao monitorar órfãs: {e}")
            if conn:
                conn.close()

    def processar_batch(self):
        """Processa um lote de pacientes"""
        self.ciclo_atual += 1

        print(f"\n{'=' * 60}")
        print(f"🔄 CICLO {self.ciclo_atual}/{MAX_CICLOS} - {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'=' * 60}")

        self.monitorar_analises_orfas()
        # Arquiva análises antigas (1x por ciclo)
        self.arquivar_analises_antigas()

        # Busca pacientes que precisam análise
        pacientes = self.buscar_pacientes_para_analise()

        if not pacientes:
            print("✅ Nenhum paciente precisa de análise no momento")
            return

        print(f"📋 {len(pacientes)} paciente(s) para analisar")

        for idx, paciente in enumerate(pacientes, 1):
            nr = paciente['nr_atendimento']

            print(f"\n[{idx}/{len(pacientes)}] 🤖 Analisando atend={nr}...")

            analise = self.analisar_paciente(paciente)

            if analise and self.salvar_analise(nr, paciente, analise):
                print(f"    ✅ Salvo: {analise['nivel_criticidade']} (Score: {analise['score_ia']})")
                print(f"    ⏱️  Tempo: {analise['tempo_processamento_ms']}ms")
            else:
                print(f"    ❌ Falha ao processar")

            # Delay entre pacientes para respeitar rate limits
            time.sleep(2)

    def run_limited(self):
        """Executa worker com limite de ciclos"""
        print(f"\n🚀 Worker de Análise Clínica IA")
        print(f"📊 Configuração:")
        print(f"   - Modelo: {self.modelo}")
        print(f"   - Ciclos: {MAX_CICLOS}")
        print(f"   - Intervalo: {INTERVALO_ANALISE}s")
        print(f"   - Batch: {BATCH_SIZE} pacientes")
        print(f"   - Validade: {HORAS_VALIDADE_ANALISE}h")
        print(f"\n")

        try:
            while self.ciclo_atual < MAX_CICLOS:
                self.processar_batch()

                if self.ciclo_atual < MAX_CICLOS:
                    print(f"\n⏳ Próximo ciclo em {INTERVALO_ANALISE}s...")
                    time.sleep(INTERVALO_ANALISE)

            print(f"\n{'=' * 60}")
            print(f"🏁 LIMITE ATINGIDO: {MAX_CICLOS} ciclos completos")
            print(f"✅ Worker finalizado com sucesso!")
            print(f"{'=' * 60}\n")

        except KeyboardInterrupt:
            print(f"\n\n⚠️ Interrompido manualmente no ciclo {self.ciclo_atual}/{MAX_CICLOS}")
        except Exception as e:
            print(f"\n\n❌ Erro fatal: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("🏥 WORKER ANÁLISE CLÍNICA IA - HOSPITAL ANCHIETA CEILÂNDIA")
    print("=" * 60 + "\n")

    analyzer = ClinicalAIAnalyzer()
    analyzer.run_limited()