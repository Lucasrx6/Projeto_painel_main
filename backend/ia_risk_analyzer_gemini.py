#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Worker de Análise Clínica IA - GOOGLE GEMINI
✅ Persistência de análises
✅ Hash para detectar mudanças
✅ Evita reprocessamento desnecessário
✅ API TOTALMENTE GRATUITA
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
import google.generativeai as genai

load_dotenv()

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# ✅ CONFIGURAÇÕES
MAX_CICLOS = 10  # Número de ciclos antes de parar
INTERVALO_ANALISE = 300  # 5 minutos entre ciclos
BATCH_SIZE = 30  # Pacientes por ciclo
HORAS_VALIDADE_ANALISE = 24  # Análise válida por 24 horas

if not GEMINI_API_KEY:
    print("❌ ERRO: GEMINI_API_KEY não configurada no .env")
    print("📝 Obtenha em: https://makersuite.google.com/app/apikey")
    sys.exit(1)


class ClinicalAIAnalyzer:
    """
    Analisador Clínico com Google Gemini
    - API TOTALMENTE GRATUITA (15 req/min)
    - Persistência inteligente de análises
    - Hash para detectar mudanças nos dados
    """

    def __init__(self):
        # Configura API do Gemini
        genai.configure(api_key=GEMINI_API_KEY)

        # Usa Gemini 2.0 Flash (mais recente e gratuito)
        self.modelo_nome = "gemini-2.0-flash-exp"
        self.modelo = genai.GenerativeModel(
            model_name=self.modelo_nome,
            generation_config={
                "temperature": 0.3,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 2048,
            }
        )

        self.ciclo_atual = 0
        print(f"✅ Cliente Google Gemini inicializado: {self.modelo_nome}")
        print(f"🆓 API GRATUITA - 15 requisições/minuto")
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
                    p.dt_nascimento,
                    p.ie_sexo,
                    ia.dt_analise AS ultima_analise
                FROM 
                    public.painel_clinico_tasy p
                    LEFT JOIN public.painel_clinico_analise_ia ia
                        ON p.nr_atendimento = ia.nr_atendimento
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
        """Formata dados do paciente para análise IA"""

        # Helper para formatar valores
        def fmt(valor, unidade=''):
            if valor is None or str(valor).upper() == 'NA':
                return 'não disponível'
            return f"{valor} {unidade}".strip()

        # Calcula idade
        idade = "N/A"
        if paciente.get('dt_nascimento'):
            try:
                nasc = paciente['dt_nascimento']
                idade = f"{(datetime.now() - nasc).days // 365} anos"
            except:
                pass

        return f"""
PACIENTE: {paciente.get('nm_pessoa_fisica', 'N/A')}
ATENDIMENTO: {paciente.get('nr_atendimento')}
IDADE: {idade}
SEXO: {paciente.get('ie_sexo', 'N/A')}
SETOR: {paciente.get('nm_setor', 'N/A')}
LEITO: {paciente.get('cd_unidade', 'N/A')}

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
        Realiza análise clínica usando Google Gemini
        Retorna dict com análise ou None se erro
        """
        contexto = self.formatar_contexto_clinico(paciente)

        prompt = f"""Você é um médico intensivista experiente analisando pacientes em UTI/Enfermaria.

{contexto}

Analise o quadro clínico e forneça:

**CRITICIDADE:** [CRÍTICO / ALTO / MODERADO / BAIXO]

**PONTOS DE ATENÇÃO:**
• [Liste 2-4 pontos mais importantes, focando em alterações significativas]

**RECOMENDAÇÕES:**
• [Liste 2-4 ações prioritárias e específicas]

Seja conciso e objetivo. Foque nos achados mais relevantes e clinicamente significativos."""

        try:
            inicio = time.time()

            # Chama Gemini API
            response = self.modelo.generate_content(prompt)

            tempo_ms = int((time.time() - inicio) * 1000)
            analise_texto = response.text

            # Extrai nível de criticidade da resposta
            criticidade = "MODERADO"  # Default
            analise_upper = analise_texto.upper()

            if "CRÍTICO" in analise_upper or "CRITICO" in analise_upper:
                criticidade = "CRÍTICO"
            elif "ALTO" in analise_upper and "CRÍTICO" not in analise_upper:
                criticidade = "ALTO"
            elif "BAIXO" in analise_upper:
                criticidade = "BAIXO"
            elif "MODERADO" in analise_upper:
                criticidade = "MODERADO"

            # Extrai seções
            pontos = ""
            if "PONTOS DE ATENÇÃO:" in analise_texto or "PONTOS DE ATENCAO:" in analise_texto:
                try:
                    texto_trabalho = analise_texto.replace("ATENCAO", "ATENÇÃO")
                    inicio_pontos = texto_trabalho.index("PONTOS DE ATENÇÃO:")

                    # Tenta achar fim (próxima seção)
                    try:
                        fim_pontos = texto_trabalho.index("RECOMENDAÇÕES:", inicio_pontos)
                    except:
                        fim_pontos = texto_trabalho.index("RECOMENDACOES:", inicio_pontos)

                    pontos = texto_trabalho[inicio_pontos:fim_pontos].strip()
                except:
                    pass

            recomendacoes = ""
            if "RECOMENDAÇÕES:" in analise_texto or "RECOMENDACOES:" in analise_texto:
                try:
                    texto_trabalho = analise_texto.replace("RECOMENDACOES", "RECOMENDAÇÕES")
                    inicio_rec = texto_trabalho.index("RECOMENDAÇÕES:")
                    recomendacoes = texto_trabalho[inicio_rec:].strip()
                except:
                    pass

            # Mapeia criticidade para score
            score_map = {
                "CRÍTICO": 90,
                "ALTO": 70,
                "MODERADO": 50,
                "BAIXO": 30
            }

            return {
                'analise_ia': analise_texto,
                'pontos_atencao': pontos,
                'recomendacoes': recomendacoes,
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
                    pontos_atencao,
                    recomendacoes,
                    nivel_criticidade, 
                    score_ia, 
                    modelo_ia,
                    tempo_processamento_ms, 
                    hash_dados
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (nr_atendimento) DO UPDATE SET
                    analise_ia = EXCLUDED.analise_ia,
                    pontos_atencao = EXCLUDED.pontos_atencao,
                    recomendacoes = EXCLUDED.recomendacoes,
                    nivel_criticidade = EXCLUDED.nivel_criticidade,
                    score_ia = EXCLUDED.score_ia,
                    hash_dados = EXCLUDED.hash_dados,
                    tempo_processamento_ms = EXCLUDED.tempo_processamento_ms,
                    dt_atualizacao = NOW()
            """

            cursor.execute(query, (
                nr_atendimento,
                paciente.get('nm_pessoa_fisica'),
                paciente.get('cd_unidade'),
                paciente.get('nm_setor'),
                analise['analise_ia'],
                analise.get('pontos_atencao', ''),
                analise.get('recomendacoes', ''),
                analise['nivel_criticidade'],
                analise['score_ia'],
                self.modelo_nome,
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
        Remove análises de pacientes que não estão mais no painel
        """
        conn = self.get_db_connection()
        if not conn:
            return

        try:
            cursor = conn.cursor()

            # Conta quantas serão removidas
            query_count = """
                SELECT COUNT(*)
                FROM public.painel_clinico_analise_ia ia
                WHERE NOT EXISTS (
                    SELECT 1 
                    FROM public.painel_clinico_tasy p
                    WHERE 
                        p.nr_atendimento = ia.nr_atendimento
                        AND p.ie_status_unidade = 'P'
                )
            """
            cursor.execute(query_count)
            count = cursor.fetchone()[0]

            if count > 0:
                # Remove análises antigas
                query_delete = """
                    DELETE FROM public.painel_clinico_analise_ia ia
                    WHERE NOT EXISTS (
                        SELECT 1 
                        FROM public.painel_clinico_tasy p
                        WHERE 
                            p.nr_atendimento = ia.nr_atendimento
                            AND p.ie_status_unidade = 'P'
                    )
                """
                cursor.execute(query_delete)
                conn.commit()
                print(f"📦 {count} análise(s) antigas removida(s)")

            cursor.close()
            conn.close()

        except Exception as e:
            print(f"⚠️ Erro ao arquivar análises: {e}")
            if conn:
                conn.close()

    def processar_batch(self):
        """Processa um lote de pacientes"""
        self.ciclo_atual += 1

        print(f"\n{'=' * 60}")
        print(f"🔄 CICLO {self.ciclo_atual}/{MAX_CICLOS} - {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'=' * 60}")

        # Arquiva análises antigas (1x por ciclo)
        self.arquivar_analises_antigas()

        # Busca pacientes que precisam análise
        pacientes = self.buscar_pacientes_para_analise()

        if not pacientes:
            print("✅ Nenhum paciente precisa de análise no momento")
            return

        print(f"📋 {len(pacientes)} paciente(s) para analisar")

        sucesso = 0
        erro = 0

        for idx, paciente in enumerate(pacientes, 1):
            nr = paciente['nr_atendimento']
            nome = paciente['nm_pessoa_fisica']

            print(f"\n[{idx}/{len(pacientes)}] 🤖 Analisando {nr} - {nome}...")

            analise = self.analisar_paciente(paciente)

            if analise and self.salvar_analise(nr, paciente, analise):
                print(f"    ✅ Salvo: {analise['nivel_criticidade']} (Score: {analise['score_ia']})")
                print(f"    ⏱️  Tempo: {analise['tempo_processamento_ms']}ms")
                sucesso += 1
            else:
                print(f"    ❌ Falha ao processar")
                erro += 1

            # Delay entre pacientes (rate limit: 15/min = 1 a cada 4s)
            time.sleep(4)

        print(f"\n📊 Resumo: {sucesso} sucesso, {erro} erros")

    def run_limited(self):
        """Executa worker com limite de ciclos"""
        print(f"\n🚀 Worker de Análise Clínica IA - GOOGLE GEMINI")
        print(f"📊 Configuração:")
        print(f"   - Modelo: {self.modelo_nome}")
        print(f"   - Ciclos: {MAX_CICLOS}")
        print(f"   - Intervalo: {INTERVALO_ANALISE}s")
        print(f"   - Batch: {BATCH_SIZE} pacientes")
        print(f"   - Validade: {HORAS_VALIDADE_ANALISE}h")
        print(f"   - API: GRATUITA 🆓")
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
    print("🏥 WORKER ANÁLISE IA - GOOGLE GEMINI")
    print("🏥 HOSPITAL ANCHIETA CEILÂNDIA")
    print("=" * 60 + "\n")

    analyzer = ClinicalAIAnalyzer()
    analyzer.run_limited()