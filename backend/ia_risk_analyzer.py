#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Worker de Análise Clínica com IA - Painel 6
Analisa pacientes usando Claude API (Anthropic)

Rodar como cron job ou processo contínuo
"""

import os
import sys
import time
import hashlib
import json
from datetime import datetime
from typing import Dict, List, Optional
import anthropic
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

# Configurações
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# Configurações do worker
INTERVALO_ANALISE = 300  # 5 minutos entre análises
BATCH_SIZE = 10  # Analisa 10 pacientes por vez
MAX_TOKENS = 2000  # Tokens máximos por resposta

# Verifica API key
if not ANTHROPIC_API_KEY:
    print("❌ ERRO: ANTHROPIC_API_KEY não configurada no .env")
    sys.exit(1)


class ClinicalAIAnalyzer:
    """Analisador de risco clínico usando Claude API"""

    def __init__(self):
        self.client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        self.modelo = "claude-sonnet-4-20250514"
        print(f"✅ Cliente Anthropic inicializado: {self.modelo}")

    def get_db_connection(self):
        """Conecta ao PostgreSQL"""
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
        """Calcula MD5 dos dados clínicos para detectar mudanças"""
        # Campos relevantes para hash
        campos_hash = [
            str(dados.get('qt_pa_sistolica', '')),
            str(dados.get('qt_pa_diastolica', '')),
            str(dados.get('qt_freq_cardiaca', '')),
            str(dados.get('qt_freq_resp', '')),
            str(dados.get('qt_temp', '')),
            str(dados.get('qt_saturacao_o2', '')),
            str(dados.get('exm_creatinina', '')),
            str(dados.get('exm_ureia', '')),
            str(dados.get('exm_lactato_art', '')),
            str(dados.get('exm_leucocitos', '')),
        ]
        dados_str = '|'.join(campos_hash)
        return hashlib.md5(dados_str.encode()).hexdigest()

    def buscar_pacientes_para_analise(self) -> List[Dict]:
        """Busca pacientes que precisam de análise"""
        conn = self.get_db_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Busca pacientes que:
            # 1. Não têm análise ainda, OU
            # 2. Tiveram dados atualizados (hash diferente)
            query = """
                SELECT 
                    p.*,
                    a.hash_dados as hash_existente,
                    a.dt_analise as dt_analise_anterior
                FROM public.painel_clinico_tasy p
                LEFT JOIN public.painel_clinico_analise_ia a 
                    ON p.nr_atendimento = a.nr_atendimento
                WHERE 
                    p.ie_status_unidade = 'P' -- Apenas pacientes ativos
                    AND (
                        a.nr_atendimento IS NULL -- Sem análise
                        OR p.dt_carga > a.dt_atualizacao -- Dados atualizados
                    )
                ORDER BY p.dt_carga DESC
                LIMIT %s
            """

            cursor.execute(query, (BATCH_SIZE,))
            pacientes = cursor.fetchall()

            cursor.close()
            conn.close()

            print(f"📋 {len(pacientes)} paciente(s) para analisar")
            return [dict(p) for p in pacientes]

        except Exception as e:
            print(f"❌ Erro ao buscar pacientes: {e}")
            if conn:
                conn.close()
            return []

    def formatar_contexto_clinico(self, paciente: Dict) -> str:
        """Formata dados do paciente para prompt da IA"""

        # Dados demográficos
        idade = ""
        if paciente.get('dt_nascimento'):
            try:
                nasc = paciente['dt_nascimento']
                idade = f"{(datetime.now() - nasc).days // 365} anos"
            except:
                pass

        contexto = f"""
PACIENTE: {paciente.get('nm_pessoa_fisica', 'N/A')}
ATENDIMENTO: {paciente.get('nr_atendimento', 'N/A')}
IDADE: {idade}
SEXO: {paciente.get('ie_sexo', 'N/A')}
SETOR: {paciente.get('nm_setor', 'N/A')}
LEITO: {paciente.get('cd_unidade', 'N/A')}
DIAS DE INTERNAÇÃO: {paciente.get('qt_dia_permanencia', 'N/A')}
CONVÊNIO: {paciente.get('ds_convenio', 'N/A')}

SINAIS VITAIS:
- PA: {paciente.get('qt_pa_sistolica', 'N/A')}/{paciente.get('qt_pa_diastolica', 'N/A')} mmHg
- PAM: {paciente.get('qt_pam', 'N/A')} mmHg
- FC: {paciente.get('qt_freq_cardiaca', 'N/A')} bpm
- FR: {paciente.get('qt_freq_resp', 'N/A')} irpm
- Temperatura: {paciente.get('qt_temp', 'N/A')}°C
- SpO2: {paciente.get('qt_saturacao_o2', 'N/A')}%
- Glicemia: {paciente.get('qt_glicemia_capilar', 'N/A')} mg/dL
- Dor: {paciente.get('qt_escala_dor', 'N/A')}/10

EXAMES LABORATORIAIS:
- Creatinina: {paciente.get('exm_creatinina', 'N/A')} mg/dL
- Ureia: {paciente.get('exm_ureia', 'N/A')} mg/dL
- Sódio: {paciente.get('exm_sodio', 'N/A')} mEq/L
- Potássio: {paciente.get('exm_potassio', 'N/A')} mEq/L
- Lactato (Art): {paciente.get('exm_lactato_art', 'N/A')} mmol/L
- Lactato (Ven): {paciente.get('exm_lactato_ven', 'N/A')} mmol/L
- Troponina: {paciente.get('exm_troponina', 'N/A')}
- Dímero-D: {paciente.get('exm_dimero_d', 'N/A')}
- Leucócitos: {paciente.get('exm_leucocitos', 'N/A')}/mm³
- Hemoglobina: {paciente.get('exm_hemoglobina', 'N/A')} g/dL
- Hematócrito: {paciente.get('exm_hematocrito', 'N/A')}%
- Plaquetas: {paciente.get('exm_plaquetas', 'N/A')}/mm³

GASOMETRIA ARTERIAL:
- pH: {paciente.get('exm_ph_art', 'N/A')}
- pCO2: {paciente.get('exm_pco2_art', 'N/A')} mmHg
- pO2: {paciente.get('exm_po2_art', 'N/A')} mmHg
- HCO3: {paciente.get('exm_hco3_art', 'N/A')} mEq/L
- BE: {paciente.get('exm_be_art', 'N/A')}
"""
        return contexto.strip()

    def analisar_paciente(self, paciente: Dict) -> Optional[Dict]:
        """Analisa um paciente usando Claude API"""

        print(f"\n🤖 Analisando paciente {paciente['nr_atendimento']}...")

        contexto = self.formatar_contexto_clinico(paciente)

        prompt = f"""Você é um médico intensivista experiente analisando dados clínicos em tempo real.

{contexto}

Analise este paciente e forneça:

1. NÍVEL DE CRITICIDADE: Classifique como CRÍTICO, ALTO, MODERADO ou BAIXO

2. PONTOS DE ATENÇÃO (liste os 3-5 mais importantes):
- Identifique alterações significativas nos sinais vitais
- Identifique alterações laboratoriais preocupantes
- Correlacione achados (ex: taquicardia + hipotensão = choque?)

3. RECOMENDAÇÕES CLÍNICAS (2-4 ações prioritárias):
- Seja específico e prático
- Priorize intervenções urgentes

Formato da resposta:
CRITICIDADE: [CRÍTICO/ALTO/MODERADO/BAIXO]

PONTOS DE ATENÇÃO:
• [ponto 1]
• [ponto 2]
• [ponto 3]

RECOMENDAÇÕES:
• [recomendação 1]
• [recomendação 2]

Seja conciso, objetivo e clinicamente preciso."""

        try:
            inicio = time.time()

            message = self.client.messages.create(
                model=self.modelo,
                max_tokens=MAX_TOKENS,
                temperature=0.3,  # Baixa criatividade = mais consistente
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )

            tempo_ms = int((time.time() - inicio) * 1000)

            analise_texto = message.content[0].text

            # Extrai criticidade
            criticidade = "MODERADO"  # padrão
            if "CRITICIDADE:" in analise_texto:
                linha = [l for l in analise_texto.split('\n') if 'CRITICIDADE:' in l][0]
                if 'CRÍTICO' in linha.upper() or 'CRITICO' in linha.upper():
                    criticidade = "CRÍTICO"
                elif 'ALTO' in linha.upper():
                    criticidade = "ALTO"
                elif 'MODERADO' in linha.upper():
                    criticidade = "MODERADO"
                elif 'BAIXO' in linha.upper():
                    criticidade = "BAIXO"

            # Extrai pontos de atenção
            pontos = ""
            if "PONTOS DE ATENÇÃO:" in analise_texto:
                try:
                    inicio_pontos = analise_texto.index("PONTOS DE ATENÇÃO:")
                    fim_pontos = analise_texto.index("RECOMENDAÇÕES:", inicio_pontos)
                    pontos = analise_texto[inicio_pontos:fim_pontos].strip()
                except:
                    pass

            # Extrai recomendações
            recomendacoes = ""
            if "RECOMENDAÇÕES:" in analise_texto:
                try:
                    inicio_rec = analise_texto.index("RECOMENDAÇÕES:")
                    recomendacoes = analise_texto[inicio_rec:].strip()
                except:
                    pass

            # Score baseado na criticidade
            score_map = {
                "CRÍTICO": 90,
                "ALTO": 70,
                "MODERADO": 50,
                "BAIXO": 30
            }
            score = score_map.get(criticidade, 50)

            resultado = {
                'analise_ia': analise_texto,
                'pontos_atencao': pontos,
                'recomendacoes': recomendacoes,
                'nivel_criticidade': criticidade,
                'score_ia': score,
                'tempo_processamento_ms': tempo_ms
            }

            print(f"✅ Análise concluída ({tempo_ms}ms) - {criticidade}")
            return resultado

        except Exception as e:
            print(f"❌ Erro ao analisar paciente: {e}")
            return None

    def salvar_analise(self, nr_atendimento: int, paciente: Dict, analise: Dict) -> bool:
        """Salva análise no banco de dados"""

        conn = self.get_db_connection()
        if not conn:
            return False

        try:
            cursor = conn.cursor()

            hash_dados = self.calcular_hash_dados(paciente)

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
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (nr_atendimento) 
                DO UPDATE SET
                    analise_ia = EXCLUDED.analise_ia,
                    pontos_atencao = EXCLUDED.pontos_atencao,
                    recomendacoes = EXCLUDED.recomendacoes,
                    nivel_criticidade = EXCLUDED.nivel_criticidade,
                    score_ia = EXCLUDED.score_ia,
                    tempo_processamento_ms = EXCLUDED.tempo_processamento_ms,
                    hash_dados = EXCLUDED.hash_dados,
                    dt_atualizacao = NOW()
            """

            cursor.execute(query, (
                nr_atendimento,
                paciente.get('nm_pessoa_fisica'),
                paciente.get('cd_unidade'),
                paciente.get('nm_setor'),
                analise['analise_ia'],
                analise['pontos_atencao'],
                analise['recomendacoes'],
                analise['nivel_criticidade'],
                analise['score_ia'],
                self.modelo,
                analise['tempo_processamento_ms'],
                hash_dados
            ))

            conn.commit()
            cursor.close()
            conn.close()

            print(f"💾 Análise salva: {nr_atendimento}")
            return True

        except Exception as e:
            print(f"❌ Erro ao salvar análise: {e}")
            if conn:
                conn.rollback()
                conn.close()
            return False

    def processar_batch(self):
        """Processa um lote de pacientes"""
        print("\n" + "=" * 60)
        print(f"🏥 INÍCIO DO CICLO - {datetime.now()}")
        print("=" * 60)

        pacientes = self.buscar_pacientes_para_analise()

        if not pacientes:
            print("✅ Nenhum paciente novo para analisar")
            return

        total_sucesso = 0
        total_erro = 0

        for paciente in pacientes:
            nr_atend = paciente['nr_atendimento']

            # Analisa
            analise = self.analisar_paciente(paciente)

            if analise:
                # Salva
                if self.salvar_analise(nr_atend, paciente, analise):
                    total_sucesso += 1
                else:
                    total_erro += 1
            else:
                total_erro += 1

            # Delay entre requisições (rate limiting)
            time.sleep(1)

        print("\n" + "=" * 60)
        print(f"📊 RESUMO: {total_sucesso} sucesso, {total_erro} erros")
        print("=" * 60)

    def run_continuous(self):
        """Roda continuamente analisando pacientes"""
        print("🚀 Worker de Análise IA iniciado")
        print(f"⏱️  Intervalo: {INTERVALO_ANALISE}s")
        print(f"📦 Batch size: {BATCH_SIZE}")
        print(f"🤖 Modelo: {self.modelo}")
        print("\nPressione Ctrl+C para parar\n")

        try:
            while True:
                self.processar_batch()
                print(f"\n⏳ Aguardando {INTERVALO_ANALISE}s até próximo ciclo...\n")
                time.sleep(INTERVALO_ANALISE)

        except KeyboardInterrupt:
            print("\n\n👋 Worker encerrado pelo usuário")
        except Exception as e:
            print(f"\n\n❌ Erro fatal: {e}")


if __name__ == "__main__":
    analyzer = ClinicalAIAnalyzer()
    analyzer.run_continuous()