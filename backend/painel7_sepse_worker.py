"""
========================================
WORKER PAINEL 7 - ANÁLISE DE SEPSE COM IA
========================================

Processamento automático de pacientes com risco de sepse
utilizando IA (Groq/Llama) para análise clínica especializada.

Funcionalidades:
- Busca pacientes com risco CRÍTICO, ALTO ou MODERADO
- Analisa critérios de sepse e sinais vitais
- Gera recomendações clínicas baseadas em evidências
- Salva análises na tabela painel_sepse_analise_ia
- Sistema de retry e fallback
- Logs detalhados

Autor: Sistema de Painéis - Hospital Anchieta Ceilândia
Data: 2024
"""

import os
import sys
import time
import logging
from datetime import datetime
from typing import Dict, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
import json

# ========================================
# CONFIGURAÇÃO
# ========================================

load_dotenv()

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    handlers=[
        logging.FileHandler('logs/painel7_worker.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

# Configurações do Worker
CONFIG = {
    'intervalo_ciclo': 300,  # 5 minutos entre ciclos
    'batch_size': 10,  # Processar 10 pacientes por vez
    'timeout_api': 30,  # Timeout de 30s por requisição
    'max_retries': 3,  # Máximo de tentativas por paciente
    'delay_entre_requests': 2  # 2 segundos entre chamadas API
}

# Credenciais API
GROQ_API_KEY = os.getenv('GROQ_API_KEY')

if not GROQ_API_KEY:
    logger.error("❌ GROQ_API_KEY não encontrada no .env")
    sys.exit(1)


# ========================================
# CONEXÃO COM BANCO DE DADOS
# ========================================

def get_db_connection():
    """Estabelece conexão com PostgreSQL"""
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            port=os.getenv('DB_PORT', '5432'),
            database=os.getenv('DB_NAME'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD')
        )
        return conn
    except Exception as e:
        logger.error(f"❌ Erro ao conectar no banco: {e}")
        raise


# ========================================
# BUSCAR PACIENTES PARA ANÁLISE
# ========================================

def buscar_pacientes_pendentes(limite: int = 10) -> List[Dict]:
    """
    Busca pacientes que precisam de análise de IA

    Critérios:
    - Nível de risco: CRÍTICO, ALTO ou MODERADO
    - Status: Presente (P)
    - Sem análise IA recente (ou análise antiga)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                v.nr_atendimento,
                v.nome_paciente,
                v.sexo,
                v.leito,
                v.setor,
                v.medico_responsavel,
                v.especialidade,
                v.dias_internacao,
                v.ds_convenio,

                -- Sinais vitais
                v.pressao_sistolica,
                v.pressao_diastolica,
                v.frequencia_cardiaca,
                v.frequencia_respiratoria,
                v.temperatura,
                v.saturacao_o2,

                -- Exames laboratoriais
                v.leucocitos,
                v.plaquetas,
                v.creatinina,
                v.lactato_arterial,
                v.lactato_venoso,

                -- Critérios de sepse
                v.criterio_hipotensao,
                v.criterio_dessaturacao,
                v.criterio_temperatura,
                v.criterio_leucocitos,
                v.criterio_taquicardia,
                v.criterio_taquipneia,
                v.criterio_plaquetopenia,
                v.criterio_disfuncao_renal,
                v.criterio_hiperlactatemia,

                -- Scores
                v.total_criterios_principais,
                v.total_criterios_adicionais,
                v.qsofa_score,
                v.nivel_risco_sepse,

                -- Timestamp para priorização
                v.data_atualizacao

            FROM public.vw_painel_sepse v

            -- Pacientes SEM análise IA ativa ou com análise antiga
            LEFT JOIN public.painel_sepse_analise_ia ia 
                ON v.nr_atendimento = ia.nr_atendimento 
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE

            WHERE v.status_unidade = 'P'
                AND v.nivel_risco_sepse IN ('CRITICO', 'ALTO', 'MODERADO')
                AND (
                    ia.nr_atendimento IS NULL  -- Sem análise
                    OR ia.data_analise < NOW() - INTERVAL '6 hours'  -- Análise antiga
                )

            ORDER BY 
                CASE v.nivel_risco_sepse
                    WHEN 'CRITICO' THEN 1
                    WHEN 'ALTO' THEN 2
                    WHEN 'MODERADO' THEN 3
                END,
                v.total_criterios_principais DESC,
                v.qsofa_score DESC

            LIMIT %s
        """

        cursor.execute(query, (limite,))
        pacientes = cursor.fetchall()

        cursor.close()
        conn.close()

        return [dict(p) for p in pacientes]

    except Exception as e:
        logger.error(f"❌ Erro ao buscar pacientes: {e}")
        return []


# ========================================
# PROMPT ESPECIALIZADO EM SEPSE
# ========================================

def gerar_prompt_sepse(paciente: Dict) -> str:
    """
    Gera prompt especializado para análise de sepse
    Baseado em critérios científicos (SIRS, qSOFA, Sepsis-3)
    """

    # Montar lista de critérios ativos
    criterios_ativos = []
    if paciente.get('criterio_hipotensao'):
        criterios_ativos.append(f"- Hipotensão (PAS: {paciente.get('pressao_sistolica', 'N/A')} mmHg)")
    if paciente.get('criterio_dessaturacao'):
        criterios_ativos.append(f"- Dessaturação (SpO2: {paciente.get('saturacao_o2', 'N/A')}%)")
    if paciente.get('criterio_temperatura'):
        criterios_ativos.append(f"- Alteração térmica (Temp: {paciente.get('temperatura', 'N/A')}°C)")
    if paciente.get('criterio_leucocitos'):
        criterios_ativos.append(f"- Leucocitose/Leucopenia (Leucócitos: {paciente.get('leucocitos', 'N/A')}/mm³)")
    if paciente.get('criterio_taquicardia'):
        criterios_ativos.append(f"- Taquicardia (FC: {paciente.get('frequencia_cardiaca', 'N/A')} bpm)")
    if paciente.get('criterio_taquipneia'):
        criterios_ativos.append(f"- Taquipneia (FR: {paciente.get('frequencia_respiratoria', 'N/A')} ipm)")

    criterios_adicionais = []
    if paciente.get('criterio_plaquetopenia'):
        criterios_adicionais.append(f"- Plaquetopenia ({paciente.get('plaquetas', 'N/A')}/mm³)")
    if paciente.get('criterio_disfuncao_renal'):
        criterios_adicionais.append(f"- Disfunção renal (Creatinina: {paciente.get('creatinina', 'N/A')} mg/dL)")
    if paciente.get('criterio_hiperlactatemia'):
        lactato = paciente.get('lactato_arterial') or paciente.get('lactato_venoso', 'N/A')
        criterios_adicionais.append(f"- Hiperlactatemia (Lactato: {lactato} mmol/L)")

    criterios_text = "\n".join(criterios_ativos) if criterios_ativos else "Nenhum critério principal ativo"
    adicionais_text = "\n".join(criterios_adicionais) if criterios_adicionais else "Nenhum"

    # LGPD: apenas dados clínicos anonimizados são enviados ao modelo externo (Groq).
    # nr_atendimento, nome_paciente e leito são VETADOS — identificam o paciente diretamente.
    # Setor, especialidade, sexo e dias de internação são dados clínicos sem identificação.
    prompt = f"""Você é um médico especialista em medicina intensiva e sepse. Analise o seguinte caso clínico:

DADOS CLÍNICOS DO PACIENTE:
- Sexo: {paciente.get('sexo', 'N/A')}
- Setor: {paciente['setor']}
- Dias de internação: {paciente.get('dias_internacao', 'N/A')}
- Especialidade: {paciente.get('especialidade', 'N/A')}

SINAIS VITAIS ATUAIS:
- Pressão Arterial: {paciente.get('pressao_sistolica', 'N/A')}/{paciente.get('pressao_diastolica', 'N/A')} mmHg
- Frequência Cardíaca: {paciente.get('frequencia_cardiaca', 'N/A')} bpm
- Frequência Respiratória: {paciente.get('frequencia_respiratoria', 'N/A')} ipm
- Temperatura: {paciente.get('temperatura', 'N/A')}°C
- Saturação O2: {paciente.get('saturacao_o2', 'N/A')}%

EXAMES LABORATORIAIS:
- Leucócitos: {paciente.get('leucocitos', 'N/A')}/mm³
- Plaquetas: {paciente.get('plaquetas', 'N/A')}/mm³
- Creatinina: {paciente.get('creatinina', 'N/A')} mg/dL
- Lactato: {paciente.get('lactato_arterial') or paciente.get('lactato_venoso', 'N/A')} mmol/L

CRITÉRIOS DE SEPSE IDENTIFICADOS ({paciente['total_criterios_principais']}/6):
{criterios_text}

CRITÉRIOS ADICIONAIS:
{adicionais_text}

SCORES:
- Total de Critérios Principais: {paciente['total_criterios_principais']}/6
- qSOFA Score: {paciente['qsofa_score']}/3
- Nível de Risco: {paciente['nivel_risco_sepse']}

TAREFA:
Com base nos critérios científicos de sepse (Sepsis-3, qSOFA, SIRS), forneça:

1. AVALIAÇÃO CLÍNICA (3-4 frases):
   - Interpretação dos sinais vitais e exames
   - Gravidade do quadro atual
   - Risco de evolução para sepse grave/choque séptico

2. RECOMENDAÇÕES IMEDIATAS (máximo 5 itens):
   - Ações prioritárias para as próximas 1-3 horas
   - Monitorização necessária
   - Exames complementares se indicados
   - Considerar protocolo de sepse institucional

3. SINAIS DE ALERTA (máximo 3 itens):
   - Quando acionar equipe médica urgentemente
   - Sinais de deterioração clínica

Seja objetivo, direto e baseado em evidências científicas. Use linguagem médica profissional mas clara. Não use formatação markdown.
"""

    return prompt


# ========================================
# CHAMAR API GROQ
# ========================================

def chamar_groq_api(prompt: str, modelo: str = "llama-3.3-70b-versatile") -> Optional[str]:
    """
    Chama API Groq para análise de IA

    Modelos disponíveis:
    - llama-3.3-70b-versatile (padrão - melhor qualidade)
    - llama-3.1-70b-versatile (alternativa)
    - mixtral-8x7b-32768 (fallback)
    """
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"

        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": modelo,
            "messages": [
                {
                    "role": "system",
                    "content": "Você é um médico intensivista especialista em sepse e medicina de emergência. Forneça análises clínicas precisas, objetivas e baseadas em evidências científicas."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.3,  # Baixa temperatura para respostas mais consistentes
            "max_tokens": 1000,
            "top_p": 0.9
        }

        logger.info(f"📡 Chamando Groq API (modelo: {modelo})...")

        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=CONFIG['timeout_api']
        )

        if response.status_code == 200:
            data = response.json()
            analise = data['choices'][0]['message']['content']
            logger.info(f"✅ Análise recebida ({len(analise)} caracteres)")
            return analise
        else:
            logger.error(f"❌ Erro API Groq: {response.status_code} - {response.text}")
            return None

    except requests.Timeout:
        logger.error("⏱️ Timeout na chamada API Groq")
        return None
    except Exception as e:
        logger.error(f"❌ Erro ao chamar Groq API: {e}")
        return None


# ========================================
# SALVAR ANÁLISE NO BANCO
# ========================================

def salvar_analise(paciente: Dict, analise: str, modelo: str, tempo_ms: int) -> bool:
    """
    Salva análise de IA no banco de dados
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Marcar análises antigas como inativas
        cursor.execute("""
            UPDATE public.painel_sepse_analise_ia
            SET ie_ativo = FALSE,
                dt_inativacao = NOW()
            WHERE nr_atendimento = %s
              AND COALESCE(ie_ativo, TRUE) = TRUE
        """, (paciente['nr_atendimento'],))

        # Inserir nova análise
        query = """
            INSERT INTO public.painel_sepse_analise_ia (
                nr_atendimento,
                criterio_hipotensao,
                criterio_dessaturacao,
                criterio_temperatura,
                criterio_leucocitos,
                criterio_taquicardia,
                criterio_taquipneia,
                criterio_plaquetopenia,
                criterio_disfuncao_renal,
                criterio_hiperlactatemia,
                pressao_sistolica,
                frequencia_cardiaca,
                frequencia_respiratoria,
                temperatura,
                saturacao_o2,
                leucocitos,
                plaquetas,
                creatinina,
                lactato,
                total_criterios_principais,
                qsofa_score,
                nivel_risco,
                analise_ia,
                resumo_clinico,
                modelo_ia,
                data_analise,
                tempo_processamento_ms,
                ie_ativo
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, NOW(), %s, TRUE
            )
        """

        # Preparar lactato (prioriza arterial)
        lactato = paciente.get('lactato_arterial') or paciente.get('lactato_venoso')

        # Gerar resumo clínico básico
        resumo = f"Paciente com {paciente['total_criterios_principais']} critérios de sepse. Nível de risco: {paciente['nivel_risco_sepse']}. qSOFA: {paciente['qsofa_score']}/3."

        cursor.execute(query, (
            paciente['nr_atendimento'],
            paciente.get('criterio_hipotensao', False),
            paciente.get('criterio_dessaturacao', False),
            paciente.get('criterio_temperatura', False),
            paciente.get('criterio_leucocitos', False),
            paciente.get('criterio_taquicardia', False),
            paciente.get('criterio_taquipneia', False),
            paciente.get('criterio_plaquetopenia', False),
            paciente.get('criterio_disfuncao_renal', False),
            paciente.get('criterio_hiperlactatemia', False),
            paciente.get('pressao_sistolica'),
            paciente.get('frequencia_cardiaca'),
            paciente.get('frequencia_respiratoria'),
            paciente.get('temperatura'),
            paciente.get('saturacao_o2'),
            paciente.get('leucocitos'),
            paciente.get('plaquetas'),
            paciente.get('creatinina'),
            lactato,
            paciente['total_criterios_principais'],
            paciente['qsofa_score'],
            paciente['nivel_risco_sepse'],
            analise,
            resumo,
            modelo,
            tempo_ms
        ))

        conn.commit()
        cursor.close()
        conn.close()

        logger.info(f"✅ Análise salva: Atendimento {paciente['nr_atendimento']}")
        return True

    except Exception as e:
        logger.error(f"❌ Erro ao salvar análise: {e}")
        return False


# ========================================
# PROCESSAR PACIENTE
# ========================================

def processar_paciente(paciente: Dict) -> bool:
    """
    Processa análise de IA para um paciente específico
    """
    nr_atend = paciente['nr_atendimento']
    risco = paciente['nivel_risco_sepse']

    logger.info(f"🔍 Processando: atend={nr_atend} | risco={risco}")

    inicio = time.time()

    try:
        # Gerar prompt
        prompt = gerar_prompt_sepse(paciente)

        # Chamar API com retry
        analise = None
        modelos = [
            "llama-3.3-70b-versatile",
            "llama-3.1-70b-versatile",
            "mixtral-8x7b-32768"
        ]

        for tentativa, modelo in enumerate(modelos, 1):
            if tentativa > 1:
                logger.warning(f"⚠️ Tentativa {tentativa} com modelo alternativo: {modelo}")
                time.sleep(CONFIG['delay_entre_requests'])

            analise = chamar_groq_api(prompt, modelo)

            if analise:
                tempo_ms = int((time.time() - inicio) * 1000)

                # Salvar no banco
                if salvar_analise(paciente, analise, modelo, tempo_ms):
                    logger.info(f"✅ Sucesso: {nr_atend} ({tempo_ms}ms)")
                    return True
                else:
                    logger.error(f"❌ Erro ao salvar: {nr_atend}")
                    return False

        # Se chegou aqui, todas as tentativas falharam
        logger.error(f"❌ Falha total: {nr_atend} (todas tentativas esgotadas)")
        return False

    except Exception as e:
        logger.error(f"❌ Erro ao processar {nr_atend}: {e}")
        return False


# ========================================
# CICLO PRINCIPAL
# ========================================

def executar_ciclo():
    """
    Executa um ciclo completo de processamento
    """
    logger.info("=" * 60)
    logger.info("🚀 INICIANDO CICLO DE ANÁLISE DE SEPSE")
    logger.info("=" * 60)

    inicio_ciclo = time.time()

    try:
        # Buscar pacientes pendentes
        pacientes = buscar_pacientes_pendentes(CONFIG['batch_size'])

        if not pacientes:
            logger.info("✅ Nenhum paciente pendente no momento")
            return

        logger.info(f"📊 {len(pacientes)} pacientes para processar")

        # Processar cada paciente
        sucessos = 0
        falhas = 0

        for i, paciente in enumerate(pacientes, 1):
            logger.info(f"\n--- Paciente {i}/{len(pacientes)} ---")

            if processar_paciente(paciente):
                sucessos += 1
            else:
                falhas += 1

            # Delay entre pacientes
            if i < len(pacientes):
                time.sleep(CONFIG['delay_entre_requests'])

        # Estatísticas do ciclo
        tempo_total = time.time() - inicio_ciclo
        logger.info("\n" + "=" * 60)
        logger.info(f"✅ CICLO CONCLUÍDO")
        logger.info(f"Tempo total: {tempo_total:.1f}s")
        logger.info(f"Sucessos: {sucessos}")
        logger.info(f"Falhas: {falhas}")
        logger.info(f"Taxa de sucesso: {(sucessos / len(pacientes) * 100):.1f}%")
        logger.info("=" * 60 + "\n")

    except Exception as e:
        logger.error(f"❌ Erro no ciclo: {e}")


# ========================================
# MAIN LOOP
# ========================================

def main():
    """
    Loop principal do worker
    """
    logger.info("=" * 60)
    logger.info("🦠 WORKER PAINEL 7 - DETECÇÃO DE SEPSE")
    logger.info("=" * 60)
    logger.info(f"Modelo IA: Groq (Llama 3.3 70B)")
    logger.info(f"Intervalo entre ciclos: {CONFIG['intervalo_ciclo']}s")
    logger.info(f"Batch size: {CONFIG['batch_size']} pacientes")
    logger.info("=" * 60 + "\n")

    ciclo = 0

    while True:
        try:
            ciclo += 1
            logger.info(f"\n🔄 CICLO #{ciclo} - {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")

            executar_ciclo()

            logger.info(f"⏸️ Aguardando {CONFIG['intervalo_ciclo']}s até próximo ciclo...\n")
            time.sleep(CONFIG['intervalo_ciclo'])

        except KeyboardInterrupt:
            logger.info("\n👋 Worker finalizado pelo usuário")
            break
        except Exception as e:
            logger.error(f"❌ Erro fatal no loop principal: {e}")
            logger.info("⏸️ Aguardando 60s antes de tentar novamente...")
            time.sleep(60)


if __name__ == "__main__":
    # Criar diretório de logs se não existir
    os.makedirs('logs', exist_ok=True)

    # Iniciar worker
    main()