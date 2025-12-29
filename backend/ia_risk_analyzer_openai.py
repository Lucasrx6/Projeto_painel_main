#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Worker de Análise Clínica IA - OPENAI GPT-4o-mini
✅ $5 grátis ao criar conta
✅ GPT-4o-mini: $0.15 por 1M tokens (super barato)
✅ Qualidade excelente
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
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# ✅ CONFIGURAÇÕES
MAX_CICLOS = 10
INTERVALO_ANALISE = 300
BATCH_SIZE = 30
HORAS_VALIDADE_ANALISE = 24

if not OPENAI_API_KEY:
    print("❌ ERRO: OPENAI_API_KEY não configurada no .env")
    print("📝 Obtenha em: https://platform.openai.com/api-keys")
    print("💰 $5 grátis ao criar conta!")
    sys.exit(1)


class ClinicalAIAnalyzer:
    """Analisador com OpenAI GPT-4o-mini"""

    def __init__(self):
        self.client = OpenAI(api_key=OPENAI_API_KEY)
        self.modelo_nome = "gpt-4o-mini"
        self.ciclo_atual = 0
        print(f"✅ Cliente OpenAI inicializado: {self.modelo_nome}")
        print(f"💰 Custo: ~$0.0003 por paciente")
        print(f"⏱️  Limite: {MAX_CICLOS} ciclos")

    def get_db_connection(self):
        try:
            conn = psycopg2.connect(
                host=DB_HOST, port=DB_PORT, database=DB_NAME,
                user=DB_USER, password=DB_PASSWORD
            )
            return conn
        except Exception as e:
            print(f"❌ Erro ao conectar DB: {e}")
            return None

    def calcular_hash_dados(self, dados: Dict) -> str:
        campos = [
            str(dados.get('qt_pa_sistolica', '')),
            str(dados.get('qt_freq_cardiaca', '')),
            str(dados.get('exm_creatinina', '')),
            str(dados.get('exm_lactato_art', '')),
        ]
        return hashlib.md5('|'.join(campos).encode()).hexdigest()

    def buscar_pacientes_para_analise(self) -> List[Dict]:
        conn = self.get_db_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            query = """
                SELECT p.*
                FROM public.painel_clinico_tasy p
                LEFT JOIN public.painel_clinico_analise_ia ia
                    ON p.nr_atendimento = ia.nr_atendimento
                WHERE 
                    p.ie_status_unidade = 'P'
                    AND (
                        ia.nr_atendimento IS NULL
                        OR EXTRACT(EPOCH FROM (NOW() - ia.dt_analise)) / 3600 > %s
                    )
                ORDER BY 
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
            print(f"❌ Erro: {e}")
            if conn:
                conn.close()
            return []

    def formatar_contexto_clinico(self, paciente: Dict) -> str:
        def fmt(v, u=''):
            if v is None or str(v).upper() == 'NA':
                return 'N/A'
            return f"{v} {u}".strip()

        idade = "N/A"
        if paciente.get('dt_nascimento'):
            try:
                idade = f"{(datetime.now() - paciente['dt_nascimento']).days // 365} anos"
            except:
                pass

        return f"""
PACIENTE: {paciente.get('nm_pessoa_fisica', 'N/A')}
IDADE: {idade}
SETOR: {paciente.get('nm_setor', 'N/A')}
LEITO: {paciente.get('cd_unidade', 'N/A')}

SINAIS VITAIS:
- PA: {fmt(paciente.get('qt_pa_sistolica'))}/{fmt(paciente.get('qt_pa_diastolica'))} mmHg
- FC: {fmt(paciente.get('qt_freq_cardiaca'), 'bpm')}
- FR: {fmt(paciente.get('qt_freq_resp'), 'irpm')}
- SpO2: {fmt(paciente.get('qt_saturacao_o2'), '%')}
- Temp: {fmt(paciente.get('qt_temp'), '°C')}

EXAMES:
- Creatinina: {fmt(paciente.get('exm_creatinina'), 'mg/dL')}
- Ureia: {fmt(paciente.get('exm_ureia'), 'mg/dL')}
- Lactato: {fmt(paciente.get('exm_lactato_art'), 'mmol/L')}
- Leucócitos: {fmt(paciente.get('exm_leucocitos'), '/mm³')}
"""

    def analisar_paciente(self, paciente: Dict) -> Optional[Dict]:
        contexto = self.formatar_contexto_clinico(paciente)

        prompt = f"""Você é médico intensivista. Analise:

{contexto}

Forneça:

CRITICIDADE: [CRÍTICO/ALTO/MODERADO/BAIXO]

PONTOS DE ATENÇÃO:
• [2-3 pontos principais]

RECOMENDAÇÕES:
• [2-3 ações prioritárias]

Seja objetivo."""

        try:
            inicio = time.time()

            response = self.client.chat.completions.create(
                model=self.modelo_nome,
                messages=[
                    {"role": "system", "content": "Você é um médico intensivista experiente."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=1500,
            )

            tempo_ms = int((time.time() - inicio) * 1000)
            analise_texto = response.choices[0].message.content

            # Extrai criticidade
            criticidade = "MODERADO"
            texto_upper = analise_texto.upper()
            if "CRÍTICO" in texto_upper or "CRITICO" in texto_upper:
                criticidade = "CRÍTICO"
            elif "ALTO" in texto_upper and "CRÍTICO" not in texto_upper:
                criticidade = "ALTO"
            elif "BAIXO" in texto_upper:
                criticidade = "BAIXO"

            score_map = {"CRÍTICO": 90, "ALTO": 70, "MODERADO": 50, "BAIXO": 30}

            return {
                'analise_ia': analise_texto,
                'nivel_criticidade': criticidade,
                'score_ia': score_map.get(criticidade, 50),
                'tempo_processamento_ms': tempo_ms,
                'hash_dados': self.calcular_hash_dados(paciente)
            }

        except Exception as e:
            print(f"❌ Erro: {e}")
            return None

    def salvar_analise(self, nr_atendimento: int, paciente: Dict, analise: Dict) -> bool:
        conn = self.get_db_connection()
        if not conn:
            return False

        try:
            cursor = conn.cursor()

            query = """
                INSERT INTO public.painel_clinico_analise_ia (
                    nr_atendimento, nm_paciente, cd_leito, nm_setor,
                    analise_ia, nivel_criticidade, score_ia, modelo_ia,
                    tempo_processamento_ms, hash_dados
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (nr_atendimento) DO UPDATE SET
                    analise_ia = EXCLUDED.analise_ia,
                    nivel_criticidade = EXCLUDED.nivel_criticidade,
                    score_ia = EXCLUDED.score_ia,
                    hash_dados = EXCLUDED.hash_dados,
                    dt_atualizacao = NOW()
            """

            cursor.execute(query, (
                nr_atendimento,
                paciente.get('nm_pessoa_fisica'),
                paciente.get('cd_unidade'),
                paciente.get('nm_setor'),
                analise['analise_ia'],
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
            print(f"❌ Erro: {e}")
            if conn:
                conn.rollback()
                conn.close()
            return False

    def processar_batch(self):
        self.ciclo_atual += 1

        print(f"\n{'=' * 60}")
        print(f"🔄 CICLO {self.ciclo_atual}/{MAX_CICLOS} - {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'=' * 60}")

        pacientes = self.buscar_pacientes_para_analise()

        if not pacientes:
            print("✅ Nenhum paciente para analisar")
            return

        print(f"📋 {len(pacientes)} paciente(s)")

        for idx, paciente in enumerate(pacientes, 1):
            nr = paciente['nr_atendimento']
            nome = paciente['nm_pessoa_fisica']

            print(f"[{idx}/{len(pacientes)}] 🤖 {nr} - {nome}...")

            analise = self.analisar_paciente(paciente)

            if analise and self.salvar_analise(nr, paciente, analise):
                print(f"    ✅ {analise['nivel_criticidade']} ({analise['tempo_processamento_ms']}ms)")
            else:
                print(f"    ❌ Falha")

            time.sleep(1)

    def run_limited(self):
        print(f"\n🚀 Worker OpenAI GPT-4o-mini")
        print(f"📊 Ciclos: {MAX_CICLOS} | Intervalo: {INTERVALO_ANALISE}s\n")

        try:
            while self.ciclo_atual < MAX_CICLOS:
                self.processar_batch()

                if self.ciclo_atual < MAX_CICLOS:
                    print(f"\n⏳ Próximo em {INTERVALO_ANALISE}s...")
                    time.sleep(INTERVALO_ANALISE)

            print(f"\n🏁 Finalizado!")

        except KeyboardInterrupt:
            print(f"\n⚠️ Interrompido")
        except Exception as e:
            print(f"\n❌ Erro: {e}")


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("🏥 WORKER OPENAI GPT-4o-mini")
    print("=" * 60 + "\n")

    analyzer = ClinicalAIAnalyzer()
    analyzer.run_limited()