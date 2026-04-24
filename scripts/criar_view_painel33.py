import psycopg2

def create_view():
    try:
        conn = psycopg2.connect('dbname=postgres user=postgres password=postgres host=localhost')
        cur = conn.cursor()
        
        sql = """CREATE OR REPLACE VIEW vw_painel33_autorizacoes AS
 WITH itens_agregados AS (
         SELECT a_1.nr_sequencia,
            COALESCE(m.qt_mat, 0::bigint) AS qt_materiais,
            COALESCE(p.qt_proc, 0::bigint) AS qt_procedimentos,
            COALESCE(d.qt_doc, 0::bigint) AS qt_documentos,
            COALESCE(m.qt_sol, 0::numeric) + COALESCE(p.qt_sol, 0::numeric) AS qt_itens_solicitados,
            COALESCE(m.qt_aut, 0::numeric) + COALESCE(p.qt_aut, 0::numeric) AS qt_itens_autorizados,
            COALESCE(m.vl_tot, 0::numeric) AS vl_total_materiais,
            d.tem_protocolo_operadora
           FROM painel33_autorizacoes_convenio a_1
             LEFT JOIN ( SELECT painel33_autorizacao_materiais.nr_sequencia_autor,
                    count(*) AS qt_mat,
                    sum(COALESCE(painel33_autorizacao_materiais.qt_solicitada, 0::numeric)) AS qt_sol,
                    sum(COALESCE(painel33_autorizacao_materiais.qt_autorizada, 0::numeric)) AS qt_aut,
                    sum(COALESCE(painel33_autorizacao_materiais.vl_total, 0::numeric)) AS vl_tot
                   FROM painel33_autorizacao_materiais
                  GROUP BY painel33_autorizacao_materiais.nr_sequencia_autor) m ON m.nr_sequencia_autor = a_1.nr_sequencia
             LEFT JOIN ( SELECT painel33_autorizacao_procedimentos.nr_sequencia_autor,
                    count(*) AS qt_proc,
                    sum(COALESCE(painel33_autorizacao_procedimentos.qt_solicitada, 0::numeric)) AS qt_sol,
                    sum(COALESCE(painel33_autorizacao_procedimentos.qt_autorizada, 0::numeric)) AS qt_aut
                   FROM painel33_autorizacao_procedimentos
                  GROUP BY painel33_autorizacao_procedimentos.nr_sequencia_autor) p ON p.nr_sequencia_autor = a_1.nr_sequencia
             LEFT JOIN ( SELECT painel33_autorizacao_documentos.nr_sequencia_autor,
                    count(*) AS qt_doc,
                    bool_or(COALESCE(NULLIF(painel33_autorizacao_documentos.nr_protoc_rec_operadora::text, ''::text), NULL::text) IS NOT NULL) AS tem_protocolo_operadora
                   FROM painel33_autorizacao_documentos
                  GROUP BY painel33_autorizacao_documentos.nr_sequencia_autor) d ON d.nr_sequencia_autor = a_1.nr_sequencia
        )
 SELECT a.nr_sequencia,
    a.nr_atendimento,
    a.nr_seq_autorizacao,
    a.cd_pessoa_fisica,
    a.nm_paciente,
    a.ds_tipo_atendimento,
    a.ds_setor_atendimento,
    a.ds_unidade,
    a.cd_convenio,
    a.ds_convenio,
    a.cd_autorizacao,
    a.cd_senha,
    a.nr_seq_estagio,
    a.ds_estagio,
    a.ie_tipo_autorizacao,
    a.ds_tipo_autorizacao,
    a.nr_seq_classif,
    a.ds_classificacao,
    a.ie_tipo_guia,
    a.ds_tipo_guia,
    a.ie_carater,
    a.ds_carater,
    a.ie_tipo_internacao,
    a.ds_tipo_internacao,
    a.cd_medico_solicitante,
    a.nm_medico_solicitante,
    a.cd_setor_origem,
    a.ds_setor_origem,
    a.cd_setor_resp,
    a.ds_setor_resp,
    a.dt_pedido_medico,
    a.dt_envio,
    a.dt_retorno,
    a.dt_autorizacao,
    a.dt_inicio_vigencia,
    a.dt_fim_vigencia,
    a.dt_atualizacao,
    a.dt_entrada_prevista,
    a.ds_observacao,
    a.ds_indicacao,
    a.ds_motivo_cancelamento,
    a.nm_usuario,
    a.nm_usuario_resp,
    ia.qt_materiais,
    ia.qt_procedimentos,
    ia.qt_documentos,
    ia.qt_itens_solicitados,
    ia.qt_itens_autorizados,
    ia.vl_total_materiais,
    ia.qt_materiais > 0 AS tem_material,
    ia.qt_procedimentos > 0 AS tem_procedimento,
    ia.qt_documentos > 0 AS tem_documento,
    (ia.qt_materiais + ia.qt_procedimentos) > 0 AS tem_item,
    COALESCE(ia.tem_protocolo_operadora, false) AS tem_protocolo_operadora,
        CASE
            WHEN a.dt_pedido_medico IS NOT NULL AND a.dt_envio IS NOT NULL THEN EXTRACT(epoch FROM a.dt_envio - a.dt_pedido_medico) / 86400.0
            ELSE NULL::numeric
        END AS dias_pedido_envio,
        CASE
            WHEN a.dt_envio IS NOT NULL AND a.dt_retorno IS NOT NULL THEN EXTRACT(epoch FROM a.dt_retorno - a.dt_envio) / 86400.0
            ELSE NULL::numeric
        END AS dias_envio_retorno,
        CASE
            WHEN a.dt_pedido_medico IS NOT NULL AND a.dt_autorizacao IS NOT NULL THEN EXTRACT(epoch FROM a.dt_autorizacao - a.dt_pedido_medico) / 86400.0
            ELSE NULL::numeric
        END AS dias_total_sla,
        CASE
            WHEN a.ds_estagio::text <> ALL (ARRAY['Autorizado'::character varying::text, 'Cancelado'::character varying::text, 'Negado'::character varying::text, 'Carência Contratual'::character varying::text]) THEN EXTRACT(epoch FROM now() - COALESCE(a.dt_pedido_medico, a.dt_autorizacao)::timestamp with time zone) / 3600.0
            ELSE NULL::numeric
        END AS horas_em_aberto,
        CASE
            WHEN a.dt_inicio_vigencia IS NULL OR a.dt_fim_vigencia IS NULL THEN 'sem_vigencia'::text
            WHEN CURRENT_DATE < a.dt_inicio_vigencia::date THEN 'a_iniciar'::text
            WHEN CURRENT_DATE > a.dt_fim_vigencia::date THEN 'vencida'::text
            ELSE 'vigente'::text
        END AS status_vigencia,
        CASE
            WHEN a.dt_fim_vigencia IS NOT NULL AND a.dt_fim_vigencia::date >= CURRENT_DATE AND a.dt_fim_vigencia::date <= (CURRENT_DATE + '2 days'::interval) THEN true
            ELSE false
        END AS vigencia_proxima_fim,
    COALESCE(sla.qt_dias_prazo, 7) AS qt_dias_prazo_convenio,
        CASE
            WHEN a.ds_estagio::text = 'Autorizado'::text AND a.dt_pedido_medico IS NOT NULL AND a.dt_autorizacao IS NOT NULL THEN
            CASE
                WHEN (EXTRACT(epoch FROM a.dt_autorizacao - a.dt_pedido_medico) / 86400.0) <= COALESCE(sla.qt_dias_prazo, 7)::numeric THEN 'dentro'::text
                ELSE 'atrasado'::text
            END
            WHEN a.ds_estagio::text <> ALL (ARRAY['Autorizado'::character varying::text, 'Cancelado'::character varying::text, 'Negado'::character varying::text, 'Carência Contratual'::character varying::text]) THEN
            CASE
                WHEN a.dt_pedido_medico IS NULL THEN 'sem_pedido'::text
                WHEN (EXTRACT(epoch FROM now() - a.dt_pedido_medico::timestamp with time zone) / 86400.0) > COALESCE(sla.qt_dias_prazo, 7)::numeric THEN 'atrasado'::text
                WHEN (EXTRACT(epoch FROM now() - a.dt_pedido_medico::timestamp with time zone) / 86400.0) > (COALESCE(sla.qt_dias_prazo, 7)::numeric * 0.7) THEN 'atencao'::text
                ELSE 'dentro'::text
            END
            ELSE NULL::text
        END AS status_sla,
        CASE
            WHEN a.ds_estagio::text = 'Autorizado'::text THEN 'Autorizado'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Cancelado'::character varying::text, 'Negado'::character varying::text, 'Carência Contratual'::character varying::text]) THEN 'negado'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Pendência pedido (Operadora)'::character varying::text]) THEN 'acao_hospital'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Inconsistência na Solicitação'::character varying::text]) THEN 'Inconsistência na Solicitação'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Aguard. Justificativa'::character varying::text]) THEN 'Aguard. Justificativa'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Autoriz. Pendente'::character varying::text]) THEN 'Autoriz. Pendente'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Solicitado OVERMIND'::character varying::text]) THEN 'Solicitado OVERMIND'::text
            ELSE 'outros'::text
        END AS grupo_estagio,
        CASE
            WHEN a.ds_estagio::text = ANY (ARRAY['Negado'::character varying::text, 'Cancelado'::character varying::text, 'Carência Contratual'::character varying::text]) THEN 'vermelho'::text
            WHEN a.dt_fim_vigencia IS NOT NULL AND CURRENT_DATE > a.dt_fim_vigencia::date AND (a.ds_estagio::text <> ALL (ARRAY['Cancelado'::character varying::text, 'Negado'::character varying::text])) THEN 'vermelho'::text
            WHEN (a.ds_estagio::text <> ALL (ARRAY['Autorizado'::character varying::text, 'Cancelado'::character varying::text, 'Negado'::character varying::text, 'Carência Contratual'::character varying::text])) AND a.dt_pedido_medico IS NOT NULL AND (EXTRACT(epoch FROM now() - a.dt_pedido_medico::timestamp with time zone) / 86400.0) > COALESCE(sla.qt_dias_prazo, 7)::numeric THEN 'vermelho'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Aguard. Justificativa'::character varying::text, 'Pendência pedido (Operadora)'::character varying::text, 'Inconsistência na Solicitação'::character varying::text]) THEN 'laranja'::text
            WHEN a.ds_estagio::text = ANY (ARRAY['Autoriz. Pendente'::character varying::text, 'Solicitado'::character varying::text, 'Solicitado OVERMIND'::character varying::text]) THEN 'amarelo'::text
            WHEN a.ds_estagio::text = 'Autorizado'::text THEN 'verde'::text
            ELSE 'amarelo'::text
        END AS status_semaforo
   FROM painel33_autorizacoes_convenio a
     LEFT JOIN itens_agregados ia ON ia.nr_sequencia = a.nr_sequencia
     LEFT JOIN painel33_convenio_sla sla ON sla.cd_convenio = a.cd_convenio AND sla.ie_ativo = 'S'::bpchar;"""
        
        cur.execute(sql)
        conn.commit()
        conn.close()
        print("View vw_painel33_autorizacoes criada com sucesso no servidor de producao!")
    except Exception as e:
        print(f"Erro ao criar view: {e}")

if __name__ == '__main__':
    create_view()
