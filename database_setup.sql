-- ════════════════════════════════════════════════════════════════════════════
-- database_setup.sql — Sistema de Painéis HAC
-- Hospital Anchieta Ceilândia (HAC) — Ceilândia-DF
-- ════════════════════════════════════════════════════════════════════════════
--
-- GERADO EM : 2026-06-10 11:35:29
-- BANCO     : PostgreSQL 18.1 on x86_64-windows
-- SCHEMA    : public
--
-- CONTEUDO:
--     80 sequences
--    127 tabelas
--     69 views
--     31 funcoes / triggers
--
-- COMO USAR (novo servidor):
--   1. Instale PostgreSQL 12+
--   2. Crie o banco (se necessario):
--         psql -U postgres -c "CREATE DATABASE postgres;"
--   3. Execute este script:
--         psql -U postgres -d postgres -f database_setup.sql
--   4. Verifique: psql -U postgres -d postgres -c "\dt"
--
-- IDEMPOTENCIA:
--   O script usa CREATE ... IF NOT EXISTS onde possivel.
--   Execute DROP ... IF EXISTS manualmente se precisar recriar objetos.
--
-- ════════════════════════════════════════════════════════════════════════════

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--


-- ------------------------------------------------------------
-- FUNCTIONS E PROCEDURES
-- ------------------------------------------------------------

-- Name: atualizar_dt_atualizacao_sepse(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.atualizar_dt_atualizacao_sepse() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.dt_atualizacao = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: calc_score_cardiaco(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_cardiaco(troponina text, dimero_d text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    trop_valor NUMERIC;
    dimero_valor NUMERIC;
    score INTEGER := 0;
BEGIN
    -- Troponina (lesão miocárdica)
    IF troponina IS NOT NULL AND troponina != 'NA' THEN
        BEGIN
            trop_valor := troponina::NUMERIC;
            
            -- Valor de referência: <0.04 ng/mL (normal)
            IF trop_valor >= 0.04 AND trop_valor < 0.5 THEN
                score := score + 2;
            ELSIF trop_valor >= 0.5 AND trop_valor < 2.0 THEN
                score := score + 3;
            ELSIF trop_valor >= 2.0 THEN
                score := score + 4; -- IAM ou lesão severa
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    
    -- D-Dímero (tromboembolismo)
    IF dimero_d IS NOT NULL AND dimero_d != 'NA' THEN
        BEGIN
            dimero_valor := dimero_d::NUMERIC;
            
            -- Valor de referência: <500 ng/mL (normal)
            IF dimero_valor >= 500 AND dimero_valor < 2000 THEN
                score := score + 1;
            ELSIF dimero_valor >= 2000 AND dimero_valor < 5000 THEN
                score := score + 2;
            ELSIF dimero_valor >= 5000 THEN
                score := score + 3; -- Alto risco TEV
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_clinico_total(numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_clinico_total(freq_resp numeric, saturacao_o2 numeric, pa_sistolica numeric, freq_cardiaca numeric, temperatura numeric, creatinina text, sodio text, potassio text, leucocitos text, lactato_art text, lactato_ven text, troponina text, dimero_d text, hemoglobina text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score_news2 INTEGER;
    score_lab INTEGER;
    score_final INTEGER;
BEGIN
    -- Calcula NEWS2 (peso maior pois sinais vitais são mais imediatos)
    score_news2 := calc_score_news2_total(
        freq_resp, saturacao_o2, pa_sistolica, 
        freq_cardiaca, temperatura
    ) * 4; -- Multiplica por 4 para dar peso adequado
    
    -- Calcula Score Laboratorial
    score_lab := calc_score_laboratorial_total(
        creatinina, sodio, potassio, leucocitos,
        lactato_art, lactato_ven, troponina, 
        dimero_d, hemoglobina
    ) * 2; -- Multiplica por 2
    
    -- Score final (0-100)
    score_final := LEAST(score_news2 + score_lab, 100);
    
    RETURN score_final;
END;
$$;


--
-- Name: calc_score_eletrolitos(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_eletrolitos(sodio text, potassio text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    na_valor NUMERIC;
    k_valor NUMERIC;
    score INTEGER := 0;
BEGIN
    -- Sódio (hiponatremia e hipernatremia)
    IF sodio IS NOT NULL AND sodio != 'NA' THEN
        BEGIN
            na_valor := sodio::NUMERIC;
            
            IF na_valor < 125 THEN
                score := score + 4; -- Hiponatremia severa
            ELSIF na_valor BETWEEN 125 AND 129 THEN
                score := score + 3;
            ELSIF na_valor BETWEEN 130 AND 134 THEN
                score := score + 2;
            ELSIF na_valor BETWEEN 135 AND 145 THEN
                score := score + 0; -- Normal
            ELSIF na_valor BETWEEN 146 AND 150 THEN
                score := score + 2;
            ELSIF na_valor BETWEEN 151 AND 155 THEN
                score := score + 3;
            ELSIF na_valor > 155 THEN
                score := score + 4; -- Hipernatremia severa
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    
    -- Potássio (hipo e hipercalemia)
    IF potassio IS NOT NULL AND potassio != 'NA' THEN
        BEGIN
            k_valor := potassio::NUMERIC;
            
            IF k_valor < 2.5 THEN
                score := score + 4; -- Hipocalemia severa
            ELSIF k_valor BETWEEN 2.5 AND 2.9 THEN
                score := score + 3;
            ELSIF k_valor BETWEEN 3.0 AND 3.4 THEN
                score := score + 2;
            ELSIF k_valor BETWEEN 3.5 AND 5.5 THEN
                score := score + 0; -- Normal
            ELSIF k_valor BETWEEN 5.6 AND 6.0 THEN
                score := score + 2;
            ELSIF k_valor BETWEEN 6.1 AND 7.0 THEN
                score := score + 3;
            ELSIF k_valor > 7.0 THEN
                score := score + 4; -- Hipercalemia severa
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_hematologico(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_hematologico(hemoglobina text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    hb_valor NUMERIC;
    score INTEGER := 0;
BEGIN
    IF hemoglobina IS NOT NULL AND hemoglobina != 'NA' THEN
        BEGIN
            hb_valor := hemoglobina::NUMERIC;
            
            -- Anemia
            IF hb_valor < 7.0 THEN
                score := 4; -- Anemia severa
            ELSIF hb_valor BETWEEN 7.0 AND 8.9 THEN
                score := 3;
            ELSIF hb_valor BETWEEN 9.0 AND 10.9 THEN
                score := 2;
            ELSIF hb_valor BETWEEN 11.0 AND 12.0 THEN
                score := 1;
            ELSE
                score := 0; -- Normal (>12 g/dL)
            END IF;
        EXCEPTION WHEN OTHERS THEN
            score := 0;
        END;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_inflamatorio(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_inflamatorio(leucocitos text, lactato_art text, lactato_ven text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    leuco_valor NUMERIC;
    lact_valor NUMERIC;
    score INTEGER := 0;
BEGIN
    -- Leucócitos (leucopenia ou leucocitose)
    IF leucocitos IS NOT NULL AND leucocitos != 'NA' THEN
        BEGIN
            leuco_valor := leucocitos::NUMERIC;
            
            IF leuco_valor < 2.0 THEN
                score := score + 4; -- Leucopenia severa
            ELSIF leuco_valor BETWEEN 2.0 AND 3.9 THEN
                score := score + 2;
            ELSIF leuco_valor BETWEEN 4.0 AND 12.0 THEN
                score := score + 0; -- Normal
            ELSIF leuco_valor BETWEEN 12.1 AND 20.0 THEN
                score := score + 2;
            ELSIF leuco_valor > 20.0 THEN
                score := score + 3; -- Leucocitose importante
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    
    -- Lactato (hipoperfusão/choque)
    BEGIN
        lact_valor := COALESCE(
            CASE WHEN lactato_art IS NOT NULL AND lactato_art != 'NA' 
                 THEN lactato_art::NUMERIC 
                 ELSE NULL END,
            CASE WHEN lactato_ven IS NOT NULL AND lactato_ven != 'NA' 
                 THEN lactato_ven::NUMERIC 
                 ELSE NULL END
        );
        
        IF lact_valor IS NOT NULL THEN
            IF lact_valor < 2.0 THEN
                score := score + 0; -- Normal
            ELSIF lact_valor BETWEEN 2.0 AND 3.9 THEN
                score := score + 2;
            ELSIF lact_valor BETWEEN 4.0 AND 5.9 THEN
                score := score + 3;
            ELSIF lact_valor >= 6.0 THEN
                score := score + 4; -- Choque/hipoperfusão severa
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_laboratorial(text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_laboratorial(p_creatinina_text text, p_ureia_text text, p_sodio_text text, p_potassio_text text, p_lactato_art_text text, p_lactato_ven_text text, p_troponina_text text, p_dimero_d_text text, p_leucocitos_text text, p_hemoglobina_text text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_score integer := 0;
    v_creatinina   numeric;
    v_ureia        numeric;
    v_sodio        numeric;
    v_potassio     numeric;
    v_lactato_art  numeric;
    v_lactato_ven  numeric;
    v_troponina    numeric;
    v_dimero_d     numeric;
    v_leucocitos   numeric;
    v_hemoglobina  numeric;
BEGIN
    -- Tenta converter trocando vírgula por ponto e removendo pontos supérfluos
    BEGIN v_creatinina  := REPLACE(REPLACE(p_creatinina_text, ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_creatinina  := NULL; END;
    BEGIN v_ureia       := REPLACE(REPLACE(p_ureia_text,      ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_ureia       := NULL; END;
    BEGIN v_sodio       := REPLACE(REPLACE(p_sodio_text,      ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_sodio       := NULL; END;
    BEGIN v_potassio    := REPLACE(REPLACE(p_potassio_text,   ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_potassio    := NULL; END;
    BEGIN v_lactato_art := REPLACE(REPLACE(p_lactato_art_text,',', '.'), ' ', '')::numeric;     EXCEPTION WHEN others THEN v_lactato_art := NULL; END;
    BEGIN v_lactato_ven := REPLACE(REPLACE(p_lactato_ven_text,',','.'), ' ', '')::numeric;    EXCEPTION WHEN others THEN v_lactato_ven := NULL; END;
    BEGIN v_troponina   := REPLACE(REPLACE(p_troponina_text,  ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_troponina   := NULL; END;
    BEGIN v_dimero_d    := REPLACE(REPLACE(p_dimero_d_text,   ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_dimero_d    := NULL; END;
    BEGIN v_leucocitos  := REPLACE(REPLACE(p_leucocitos_text, ',', '.'), ' ', '')::numeric;   EXCEPTION WHEN others THEN v_leucocitos  := NULL; END;
    BEGIN v_hemoglobina := REPLACE(REPLACE(p_hemoglobina_text,',','.'), ' ', '')::numeric;    EXCEPTION WHEN others THEN v_hemoglobina := NULL; END;

    -- Regras simples (pode ajustar depois com o time clínico)

    -- Creatinina (disfunção renal)
    IF v_creatinina IS NOT NULL THEN
        IF v_creatinina >= 3.0 THEN
            v_score := v_score + 3;
        ELSIF v_creatinina BETWEEN 2.0 AND 2.99 THEN
            v_score := v_score + 2;
        ELSIF v_creatinina BETWEEN 1.3 AND 1.99 THEN
            v_score := v_score + 1;
        END IF;
    END IF;

    -- Lactato (art ou venoso) – pega o maior dos dois
    IF v_lactato_art IS NOT NULL OR v_lactato_ven IS NOT NULL THEN
        v_lactato_art := COALESCE(v_lactato_art, 0);
        v_lactato_ven := COALESCE(v_lactato_ven, 0);
        IF GREATEST(v_lactato_art, v_lactato_ven) >= 4.0 THEN
            v_score := v_score + 3;
        ELSIF GREATEST(v_lactato_art, v_lactato_ven) BETWEEN 2.0 AND 3.99 THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- Potássio
    IF v_potassio IS NOT NULL THEN
        IF v_potassio < 3.0 OR v_potassio > 6.0 THEN
            v_score := v_score + 3;
        ELSIF v_potassio BETWEEN 3.0 AND 3.4 THEN
            v_score := v_score + 1;
        ELSIF v_potassio BETWEEN 5.1 AND 6.0 THEN
            v_score := v_score + 1;
        END IF;
    END IF;

    -- Sódio
    IF v_sodio IS NOT NULL THEN
        IF v_sodio < 125 OR v_sodio > 155 THEN
            v_score := v_score + 3;
        ELSIF v_sodio BETWEEN 125 AND 129 OR v_sodio BETWEEN 150 AND 155 THEN
            v_score := v_score + 1;
        END IF;
    END IF;

    -- Leucócitos (infecção / inflamação)
    IF v_leucocitos IS NOT NULL THEN
        IF v_leucocitos < 2000 OR v_leucocitos > 30000 THEN
            v_score := v_score + 3;
        ELSIF v_leucocitos BETWEEN 2000 AND 3999 OR v_leucocitos BETWEEN 15000 AND 30000 THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- Hemoglobina (anemia grave)
    IF v_hemoglobina IS NOT NULL THEN
        IF v_hemoglobina < 7 THEN
            v_score := v_score + 3;
        ELSIF v_hemoglobina BETWEEN 7 AND 9 THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- Troponina (cardíaco) – aqui só damos um peso leve
    IF v_troponina IS NOT NULL THEN
        IF v_troponina > 0.04 THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- Dímero-D – usamos mais como marcador de risco adicional
    IF v_dimero_d IS NOT NULL THEN
        IF v_dimero_d > 1000 THEN
            v_score := v_score + 1;
        END IF;
    END IF;

    RETURN v_score;
END;
$$;


--
-- Name: calc_score_laboratorial_total(text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_laboratorial_total(creatinina text, sodio text, potassio text, leucocitos text, lactato_art text, lactato_ven text, troponina text, dimero_d text, hemoglobina text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score_total INTEGER := 0;
BEGIN
    score_total := score_total + calc_score_sofa_renal(creatinina);
    score_total := score_total + calc_score_eletrolitos(sodio, potassio);
    score_total := score_total + calc_score_inflamatorio(leucocitos, lactato_art, lactato_ven);
    score_total := score_total + calc_score_cardiaco(troponina, dimero_d);
    score_total := score_total + calc_score_hematologico(hemoglobina);
    
    RETURN score_total;
END;
$$;


--
-- Name: calc_score_news2_cardiovascular(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_news2_cardiovascular(pa_sistolica numeric, freq_cardiaca numeric) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- Pressão Arterial Sistólica (NEWS2)
    IF pa_sistolica IS NOT NULL THEN
        IF pa_sistolica <= 90 THEN
            score := score + 3;
        ELSIF pa_sistolica BETWEEN 91 AND 100 THEN
            score := score + 2;
        ELSIF pa_sistolica BETWEEN 101 AND 110 THEN
            score := score + 1;
        ELSIF pa_sistolica BETWEEN 111 AND 219 THEN
            score := score + 0; -- Normal
        ELSIF pa_sistolica >= 220 THEN
            score := score + 3;
        END IF;
    END IF;
    
    -- Frequência Cardíaca (NEWS2)
    IF freq_cardiaca IS NOT NULL THEN
        IF freq_cardiaca <= 40 THEN
            score := score + 3;
        ELSIF freq_cardiaca BETWEEN 41 AND 50 THEN
            score := score + 1;
        ELSIF freq_cardiaca BETWEEN 51 AND 90 THEN
            score := score + 0; -- Normal
        ELSIF freq_cardiaca BETWEEN 91 AND 110 THEN
            score := score + 1;
        ELSIF freq_cardiaca BETWEEN 111 AND 130 THEN
            score := score + 2;
        ELSIF freq_cardiaca >= 131 THEN
            score := score + 3;
        END IF;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_news2_respiratorio(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_news2_respiratorio(freq_resp numeric, saturacao_o2 numeric) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- Frequência Respiratória (NEWS2 oficial)
    IF freq_resp IS NOT NULL THEN
        IF freq_resp <= 8 THEN
            score := score + 3;
        ELSIF freq_resp BETWEEN 9 AND 11 THEN
            score := score + 1;
        ELSIF freq_resp BETWEEN 12 AND 20 THEN
            score := score + 0; -- Normal
        ELSIF freq_resp BETWEEN 21 AND 24 THEN
            score := score + 2;
        ELSIF freq_resp >= 25 THEN
            score := score + 3;
        END IF;
    END IF;
    
    -- Saturação O2 (NEWS2 Scale 1 - ar ambiente)
    IF saturacao_o2 IS NOT NULL THEN
        IF saturacao_o2 <= 91 THEN
            score := score + 3;
        ELSIF saturacao_o2 BETWEEN 92 AND 93 THEN
            score := score + 2;
        ELSIF saturacao_o2 BETWEEN 94 AND 95 THEN
            score := score + 1;
        ELSIF saturacao_o2 >= 96 THEN
            score := score + 0; -- Normal
        END IF;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_news2_temperatura(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_news2_temperatura(temperatura numeric) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    IF temperatura IS NOT NULL THEN
        IF temperatura <= 35.0 THEN
            score := 3;
        ELSIF temperatura BETWEEN 35.1 AND 36.0 THEN
            score := 1;
        ELSIF temperatura BETWEEN 36.1 AND 38.0 THEN
            score := 0; -- Normal
        ELSIF temperatura BETWEEN 38.1 AND 39.0 THEN
            score := 1;
        ELSIF temperatura >= 39.1 THEN
            score := 2;
        END IF;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: calc_score_news2_total(numeric, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_news2_total(freq_resp numeric, saturacao_o2 numeric, pa_sistolica numeric, freq_cardiaca numeric, temperatura numeric) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    score_total INTEGER := 0;
BEGIN
    score_total := score_total + calc_score_news2_respiratorio(freq_resp, saturacao_o2);
    score_total := score_total + calc_score_news2_cardiovascular(pa_sistolica, freq_cardiaca);
    score_total := score_total + calc_score_news2_temperatura(temperatura);
    
    RETURN score_total;
END;
$$;


--
-- Name: calc_score_risco_vital(numeric, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_risco_vital(p_freq_resp numeric, p_pa_sistolica numeric, p_freq_cardiaca numeric, p_temp numeric, p_spo2 numeric) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_score integer := 0;
BEGIN
    -- Frequência respiratória (FR)
    IF p_freq_resp IS NOT NULL THEN
        IF p_freq_resp <= 8 THEN
            v_score := v_score + 3;
        ELSIF p_freq_resp BETWEEN 9 AND 11 THEN
            v_score := v_score + 1;
        ELSIF p_freq_resp BETWEEN 12 AND 20 THEN
            v_score := v_score + 0;
        ELSIF p_freq_resp BETWEEN 21 AND 29 THEN
            v_score := v_score + 2;
        ELSIF p_freq_resp >= 30 THEN
            v_score := v_score + 3;
        END IF;
    END IF;

    -- PA sistólica
    IF p_pa_sistolica IS NOT NULL THEN
        IF p_pa_sistolica <= 90 THEN
            v_score := v_score + 3;
        ELSIF p_pa_sistolica BETWEEN 91 AND 100 THEN
            v_score := v_score + 2;
        ELSIF p_pa_sistolica BETWEEN 101 AND 110 THEN
            v_score := v_score + 1;
        ELSIF p_pa_sistolica BETWEEN 111 AND 219 THEN
            v_score := v_score + 0;
        ELSIF p_pa_sistolica >= 220 THEN
            v_score := v_score + 3;
        END IF;
    END IF;

    -- Frequência cardíaca (FC)
    IF p_freq_cardiaca IS NOT NULL THEN
        IF p_freq_cardiaca <= 40 THEN
            v_score := v_score + 3;
        ELSIF p_freq_cardiaca BETWEEN 41 AND 50 THEN
            v_score := v_score + 1;
        ELSIF p_freq_cardiaca BETWEEN 51 AND 90 THEN
            v_score := v_score + 0;
        ELSIF p_freq_cardiaca BETWEEN 91 AND 110 THEN
            v_score := v_score + 1;
        ELSIF p_freq_cardiaca BETWEEN 111 AND 130 THEN
            v_score := v_score + 2;
        ELSIF p_freq_cardiaca >= 131 THEN
            v_score := v_score + 3;
        END IF;
    END IF;

    -- Temperatura
    IF p_temp IS NOT NULL THEN
        IF p_temp <= 35.0 THEN
            v_score := v_score + 3;
        ELSIF p_temp BETWEEN 35.1 AND 36.0 THEN
            v_score := v_score + 1;
        ELSIF p_temp BETWEEN 36.1 AND 38.0 THEN
            v_score := v_score + 0;
        ELSIF p_temp BETWEEN 38.1 AND 39.0 THEN
            v_score := v_score + 1;
        ELSIF p_temp >= 39.1 THEN
            v_score := v_score + 2;
        END IF;
    END IF;

    -- Saturação O2 (SpO2)
    IF p_spo2 IS NOT NULL THEN
        IF p_spo2 <= 91 THEN
            v_score := v_score + 3;
        ELSIF p_spo2 BETWEEN 92 AND 93 THEN
            v_score := v_score + 2;
        ELSIF p_spo2 BETWEEN 94 AND 95 THEN
            v_score := v_score + 1;
        ELSIF p_spo2 >= 96 THEN
            v_score := v_score + 0;
        END IF;
    END IF;

    RETURN v_score;
END;
$$;


--
-- Name: calc_score_sofa_renal(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_score_sofa_renal(creatinina text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    creat_valor NUMERIC;
    score INTEGER := 0;
BEGIN
    -- Converte texto para número
    IF creatinina IS NOT NULL AND creatinina != 'NA' THEN
        BEGIN
            creat_valor := creatinina::NUMERIC;
            
            -- SOFA Renal Score
            IF creat_valor < 1.2 THEN
                score := 0; -- Normal
            ELSIF creat_valor BETWEEN 1.2 AND 1.9 THEN
                score := 1;
            ELSIF creat_valor BETWEEN 2.0 AND 3.4 THEN
                score := 2;
            ELSIF creat_valor BETWEEN 3.5 AND 4.9 THEN
                score := 3;
            ELSIF creat_valor >= 5.0 THEN
                score := 4;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            score := 0;
        END;
    END IF;
    
    RETURN score;
END;
$$;


--
-- Name: classifica_risco_news2(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.classifica_risco_news2(score_news2 integer) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    IF score_news2 = 0 THEN
        RETURN 'BAIXO';
    ELSIF score_news2 BETWEEN 1 AND 4 THEN
        RETURN 'BAIXO-MODERADO';
    ELSIF score_news2 BETWEEN 5 AND 6 THEN
        RETURN 'MODERADO'; -- Threshold crítico NEWS2
    ELSIF score_news2 >= 7 THEN
        RETURN 'ALTO-CRÍTICO';
    ELSE
        RETURN 'INDETERMINADO';
    END IF;
END;
$$;


--
-- Name: classifica_risco_total(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.classifica_risco_total(score_total integer) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    IF score_total < 15 THEN
        RETURN 'BAIXO';
    ELSIF score_total BETWEEN 15 AND 29 THEN
        RETURN 'BAIXO-MODERADO';
    ELSIF score_total BETWEEN 30 AND 49 THEN
        RETURN 'MODERADO';
    ELSIF score_total BETWEEN 50 AND 69 THEN
        RETURN 'ALTO';
    ELSIF score_total >= 70 THEN
        RETURN 'CRÍTICO';
    ELSE
        RETURN 'INDETERMINADO';
    END IF;
END;
$$;


--
-- Name: classifica_risco_vital(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.classifica_risco_vital(p_score integer) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF p_score IS NULL THEN
        RETURN 'Desconhecido';
    ELSIF p_score >= 7 THEN
        RETURN 'Alto';
    ELSIF p_score BETWEEN 5 AND 6 THEN
        RETURN 'Moderado';
    ELSE
        RETURN 'Baixo';
    END IF;
END;
$$;


--
-- Name: fn_chamados_atualizar_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_chamados_atualizar_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.data_atualizacao = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_chamados_locais_atualizar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_chamados_locais_atualizar() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.data_atualizacao = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_chamados_problemas_atualizar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_chamados_problemas_atualizar() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.data_atualizacao = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_chamados_registrar_historico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_chamados_registrar_historico() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Registra mudanca de status
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO chamados_historico (chamado_id, acao, status_anterior, status_novo, descricao, usuario)
        VALUES (
            NEW.id,
            CASE NEW.status
                WHEN 'em_atendimento' THEN 'inicio_atendimento'
                WHEN 'fechado' THEN 'fechamento'
                WHEN 'inativo' THEN 'inativacao'
                ELSE 'alteracao_status'
            END,
            OLD.status,
            NEW.status,
            CASE NEW.status
                WHEN 'em_atendimento' THEN 'Tecnico ' || COALESCE(NEW.tecnico_atendimento, 'N/I') || ' iniciou atendimento'
                WHEN 'fechado' THEN 'Chamado fechado por ' || COALESCE(NEW.tecnico_atendimento, 'N/I')
                WHEN 'inativo' THEN 'Chamado inativado por ' || COALESCE(NEW.atualizado_por, 'N/I')
                ELSE 'Status alterado'
            END,
            COALESCE(NEW.atualizado_por, NEW.tecnico_atendimento, 'sistema')
        );
    END IF;

    -- Registra primeira visualizacao
    IF OLD.visualizado = FALSE AND NEW.visualizado = TRUE THEN
        INSERT INTO chamados_historico (chamado_id, acao, descricao, usuario)
        VALUES (
            NEW.id,
            'visualizacao',
            'Chamado visualizado pela primeira vez',
            COALESCE(NEW.atualizado_por, 'sistema')
        );
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: limpar_rtf(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.limpar_rtf(texto_rtf text) RETURNS text
    LANGUAGE plpgsql
    AS $_$
DECLARE
    resultado text;
BEGIN
    IF texto_rtf IS NULL OR texto_rtf = '' THEN
        RETURN NULL;
    END IF;

    -- Se nao for RTF, retorna direto
    IF LEFT(TRIM(texto_rtf), 5) != '{\rtf' THEN
        RETURN TRIM(texto_rtf);
    END IF;

    resultado := texto_rtf;

    -- Remove grupos de header: fonttbl, colortbl, stylesheet, listtable, etc
    -- Pega tudo entre \pard (inicio do paragrafo) ate o final
    resultado := substring(resultado from '\\pard\s(.+)$');

    IF resultado IS NULL OR resultado = '' THEN
        RETURN NULL;
    END IF;

    -- Remove comandos RTF (\palavra, \palavraN, \palavra-N)
    resultado := regexp_replace(resultado, '\\[a-zA-Z]+[-]?[0-9]*\s?', ' ', 'g');

    -- Converte acentos \\''xx (hex cp1252)
    resultado := regexp_replace(resultado, '\\''c0', 'A', 'g');
    resultado := regexp_replace(resultado, '\\''c1', 'A', 'g');
    resultado := regexp_replace(resultado, '\\''c2', 'A', 'g');
    resultado := regexp_replace(resultado, '\\''c3', 'A', 'g');
    resultado := regexp_replace(resultado, '\\''c7', 'C', 'g');
    resultado := regexp_replace(resultado, '\\''c9', 'E', 'g');
    resultado := regexp_replace(resultado, '\\''cd', 'I', 'g');
    resultado := regexp_replace(resultado, '\\''d3', 'O', 'g');
    resultado := regexp_replace(resultado, '\\''da', 'U', 'g');
    resultado := regexp_replace(resultado, '\\''e0', 'a', 'g');
    resultado := regexp_replace(resultado, '\\''e1', 'a', 'g');
    resultado := regexp_replace(resultado, '\\''e2', 'a', 'g');
    resultado := regexp_replace(resultado, '\\''e3', 'a', 'g');
    resultado := regexp_replace(resultado, '\\''e7', 'c', 'g');
    resultado := regexp_replace(resultado, '\\''e9', 'e', 'g');
    resultado := regexp_replace(resultado, '\\''ea', 'e', 'g');
    resultado := regexp_replace(resultado, '\\''ed', 'i', 'g');
    resultado := regexp_replace(resultado, '\\''f3', 'o', 'g');
    resultado := regexp_replace(resultado, '\\''f4', 'o', 'g');
    resultado := regexp_replace(resultado, '\\''f5', 'o', 'g');
    resultado := regexp_replace(resultado, '\\''fa', 'u', 'g');
    resultado := regexp_replace(resultado, '\\''fc', 'u', 'g');

    -- Remove qualquer \'xx restante
    resultado := regexp_replace(resultado, '\\''[0-9a-fA-F]{2}', '', 'g');

    -- Remove barras, chaves, asteriscos
    resultado := regexp_replace(resultado, '[\\{}\*]', '', 'g');

    -- Remove espacos multiplos
    resultado := regexp_replace(resultado, '\s+', ' ', 'g');

    RETURN TRIM(resultado);
END;
$_$;


--
-- Name: update_dt_atualizacao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_dt_atualizacao() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.dt_atualizacao = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_painel_enfermaria_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_painel_enfermaria_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.dt_atualizacao = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--


-- ------------------------------------------------------------
-- TABELAS
-- ------------------------------------------------------------

-- Name: access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.access_log (
    id bigint NOT NULL,
    dt_acesso timestamp with time zone DEFAULT now() NOT NULL,
    ip character varying(45) NOT NULL,
    painel_codigo character varying(50),
    painel_nome character varying(150),
    endpoint character varying(300),
    descricao text NOT NULL,
    metodo character varying(10) DEFAULT 'GET'::character varying NOT NULL,
    status_code smallint,
    duracao_ms integer,
    usuario_id integer,
    usuario_nome character varying(100),
    tipo_acesso character varying(30) DEFAULT 'painel'::character varying
);


--


-- ------------------------------------------------------------
-- SEQUENCES
-- ------------------------------------------------------------

-- Name: access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--


-- ------------------------------------------------------------
-- SEQUENCES OWNED BY
-- ------------------------------------------------------------

-- Name: access_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.access_log_id_seq OWNED BY public.access_log.id;


--
-- Name: agenda_paciente_cirurgias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.agenda_paciente_cirurgias (
    id integer NOT NULL,
    dt_agenda timestamp without time zone NOT NULL,
    ds_agenda character varying(255),
    cd_agenda integer DEFAULT 0,
    nr_minuto_duracao integer DEFAULT 60,
    nm_paciente_pf character varying(255) NOT NULL,
    ds_convenio character varying(100),
    nm_medico character varying(255) NOT NULL,
    ds_idade_abrev character varying(20),
    setor_cirurgia character varying(100),
    nm_instrumentador character varying(255),
    nm_circulante character varying(255),
    dt_entrada_tasy timestamp without time zone,
    nr_atendimento integer,
    nr_cirurgia integer,
    cd_pessoa_fisica character varying(50),
    nr_sequencia integer,
    ie_origem_proced character varying(10),
    ie_tipo_classif character varying(10),
    unidade_atendimento character varying(200),
    ds_tipo_atendimento character varying(255),
    hr_inicio character varying(10) NOT NULL,
    nr_seq_proc_interno integer,
    ie_cancelada character varying(1) DEFAULT 'N'::character varying,
    nr_prescr_agenda integer,
    ds_proc_cir character varying(500) NOT NULL,
    ie_status_cirurgia integer DEFAULT '-1'::integer NOT NULL,
    ds_status character varying(50),
    nr_prescricao integer,
    ie_tipo_atendimento character varying(10),
    cd_medico character varying(50),
    cd_procedimento integer,
    ds_carater_cirurgia character varying(100),
    cd_tipo_agenda integer DEFAULT 1,
    cd_estabelecimento integer DEFAULT 1,
    ie_status_agenda character varying(1) DEFAULT 'A'::character varying,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    evento character varying(255),
    evento_codigo integer,
    evento_descricao character varying(50),
    inicio_cirurgia character varying(25),
    tempo character varying(20),
    CONSTRAINT chk_status CHECK ((ie_status_cirurgia = ANY (ARRAY['-1'::integer, 0, 1, 2, 3, 4, 5])))
);


--
-- Name: agenda_paciente_cirurgias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.agenda_paciente_cirurgias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agenda_paciente_cirurgias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agenda_paciente_cirurgias_id_seq OWNED BY public.agenda_paciente_cirurgias.id;


--
-- Name: bi_conv_amb_c_ambulatorio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_conv_amb_c_ambulatorio (
    nr_atendimento bigint,
    nm_paciente character varying(4000),
    data_atendimento timestamp without time zone,
    clinica character varying(4000),
    classificacao bigint,
    convenio character varying(4000),
    conversao character varying(11),
    medico character varying(50)
);


--
-- Name: bi_conv_amb_c_cirurgia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_conv_amb_c_cirurgia (
    nr_atendimento double precision,
    cd_pessoa_fisica character varying(10),
    nm_paciente character varying(255),
    data_atendimento timestamp without time zone,
    clinica character varying(4000),
    medico character varying(4000),
    convenio character varying(4000),
    procedimento character varying(4000)
);


--
-- Name: bi_conv_amb_c_hemodinamica; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_conv_amb_c_hemodinamica (
    nr_atendimento double precision,
    cd_pessoa_fisica character varying(10),
    nm_paciente character varying(255),
    data_atendimento timestamp without time zone,
    clinica character varying(4000),
    medico character varying(4000),
    convenio character varying(4000),
    procedimento character varying(4000)
);


--
-- Name: bi_conv_amb_c_laboratorio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_conv_amb_c_laboratorio (
    nr_atendimento bigint,
    data_atendimento timestamp without time zone,
    clinica character varying(4000),
    medico character varying(4000),
    convenio character varying(4000),
    conversao character varying(11),
    exame character varying(4000),
    qt_procedimento numeric(11,3)
);


--
-- Name: bi_conv_amb_c_radiologia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_conv_amb_c_radiologia (
    nr_atendimento bigint,
    data_atendimento timestamp without time zone,
    clinica character varying(4000),
    medico character varying(4000),
    convenio character varying(4000),
    conversao character varying(10),
    exame character varying(4000),
    nr_sequencia_interno bigint,
    qt_procedimento numeric(11,3)
);


--
-- Name: bi_enviado_produzido_db_excluidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_enviado_produzido_db_excluidos (
    ds_convenio character varying(4000),
    atendimento bigint,
    setor character varying(4000),
    paciente character varying(4000),
    tipo character varying(8),
    dt_entrada timestamp without time zone,
    dt_alta timestamp without time zone,
    dt_conta timestamp without time zone,
    dt_mesano_referencia timestamp without time zone,
    tipo_item character varying(13),
    ds_item character varying(4000),
    motivo_exclusao character varying(4000),
    quantidade double precision,
    vl_unitario double precision,
    vl_produzido double precision,
    nm_usuario character varying(15),
    usuario_exclusao character varying(4000)
);


--
-- Name: bi_enviado_produzido_db_incluidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_enviado_produzido_db_incluidos (
    ds_convenio character varying(4000),
    atendimento bigint,
    setor character varying(4000),
    paciente character varying(4000),
    tipo character varying(8),
    dt_entrada timestamp without time zone,
    dt_alta timestamp without time zone,
    dt_conta timestamp without time zone,
    dt_mesano_referencia timestamp without time zone,
    tipo_item character varying(13),
    ds_item character varying(4000),
    motivo_inclusao character varying(4000),
    quantidade double precision,
    vl_unitario double precision,
    vl_produzido double precision
);


--
-- Name: bi_enviado_produzido_db_zerados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_enviado_produzido_db_zerados (
    dt_conta timestamp without time zone,
    nr_atendimento bigint,
    vl_produzido double precision,
    setor_paciente character varying(4000),
    ds_convenio character varying(4000),
    ds_item character varying(4000),
    quantidade double precision,
    paciente character varying(4000)
);


--
-- Name: bi_envio_prod_c_envio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_envio_prod_c_envio (
    atendimento bigint,
    nr_seq_protocolo bigint,
    "OBTER_NOME_CONVENIO(E.CD_CONVENIO)" character varying(4000),
    conta bigint,
    paciente character varying(4000),
    setor character varying(4000),
    mes_ref timestamp without time zone,
    ds_item character varying(4000),
    grupo_receita character varying(12),
    valor double precision,
    nr_sequencia bigint
);


--
-- Name: bi_envio_prod_c_producao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_envio_prod_c_producao (
    nr_atendimento bigint,
    dt_conta timestamp without time zone,
    vl_produzido double precision,
    setor_paciente character varying(4000),
    ds_convenio character varying(4000),
    grupo_receita character varying(12),
    ds_item character varying(4000),
    quantidade double precision,
    paciente character varying(4000),
    sequencia bigint,
    tipo_atendimento character varying(30),
    ds_carater_inter_sus character varying(40),
    ds_clinica character varying(30)
);


--
-- Name: bi_envio_prod_c_ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_envio_prod_c_ticket (
    cd_pessoa_fisica character varying(10),
    setor_paciente character varying(4000),
    nr_atendimento bigint,
    paciente character varying(4000),
    ds_convenio character varying(4000),
    dt_conta timestamp without time zone,
    quantidade_setor double precision,
    producao double precision,
    ds_clinica character varying(30),
    grupo_receita character varying(12),
    tipo_atendimento character varying(30)
);


--
-- Name: bi_envio_prod_c_ticket_rad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_envio_prod_c_ticket_rad (
    cd_pessoa_fisica character varying(10),
    nr_atendimento bigint,
    paciente character varying(4000),
    ds_convenio character varying(4000),
    dt_conta timestamp without time zone,
    quantidade_setor double precision,
    producao double precision,
    ds_clinica character varying(30),
    grupo_receita character varying(12),
    tipo_atendimento character varying(30),
    setor_paciente character varying(21)
);


--
-- Name: bi_informacoes_cirurgicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_informacoes_cirurgicas (
    dt_referencia timestamp without time zone,
    dt_inicio_prevista timestamp without time zone,
    dt_inicio_real timestamp without time zone,
    status character varying(200),
    setor character varying(16),
    ds_convenio character varying(200),
    nr_atendimento bigint,
    paciente character varying(4000),
    cirurgiao character varying(200),
    especialidade character varying(200),
    anestesista character varying(200),
    cd_procedimento bigint,
    procedimento character varying(4000),
    sexo character varying(4000),
    ie_faixa_etaria character varying(10),
    carater character varying(12),
    municipio character varying(255),
    dia_semana character varying(30),
    clinica character varying(255)
);


--
-- Name: bi_producao_fonoaudiologia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_fonoaudiologia (
    tipo_atendimento character varying(4000),
    profissional character varying(4000),
    atendimento bigint,
    conta bigint,
    paciente character varying(4000),
    "convÊnio" character varying(4000),
    data_procedimento timestamp without time zone,
    codigo_procedimento bigint,
    descricao_procedimento character varying(4000),
    quantidade numeric(12,3),
    valor_procedimento numeric(17,2)
);


--
-- Name: bi_producao_fonoaudiologia_documento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_fonoaudiologia_documento (
    documento character varying(19),
    quantidade_atendimentos double precision,
    dt_evolucao timestamp without time zone
);


--
-- Name: bi_producao_ps_c_producao_geral; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_producao_geral (
    dt_conta timestamp without time zone,
    atendimento bigint,
    grupo_receita character varying(12),
    vl_total double precision
);


--
-- Name: bi_producao_ps_c_producao_int_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_producao_int_ps (
    mes_producao timestamp without time zone,
    tipo_atendimento character varying(9),
    atendimento_int bigint,
    atendimento_ps double precision,
    convenio character varying(4000),
    clinica character varying(4000),
    cid character varying(4000),
    grupo_receita character varying(12),
    valor_conta double precision,
    medico character varying(50)
);


--
-- Name: bi_producao_ps_c_producao_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_producao_ps (
    mes_producao timestamp without time zone,
    tipo_atendimento character varying(14),
    atendimento bigint,
    medico character varying(255),
    convenio character varying(4000),
    clinica character varying(4000),
    cid character varying(4000),
    grupo_receita character varying(12),
    valor_conta double precision
);


--
-- Name: bi_producao_ps_c_qtd_atend_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_qtd_atend_ps (
    dt_entrada timestamp without time zone,
    atendimento_ps bigint,
    medico character varying(255),
    convenio character varying(255),
    clinica character varying(30),
    cid character varying(4000),
    sn_conversao_ps character varying(1),
    tipo_atendimento character varying(30),
    setor_internacao character varying(16),
    nm_paciente character varying(255)
);


--
-- Name: bi_producao_ps_c_qtd_int_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_qtd_int_ps (
    dt_entrada timestamp without time zone,
    tipo_atendimento character varying(9),
    atendimento_int bigint,
    convenio character varying(4000),
    clinica character varying(4000),
    cid character varying(4000),
    atendimento_ps double precision,
    medico character varying(50),
    setor_internacao character varying(19)
);


--
-- Name: bi_producao_ps_c_qtd_int_ps_2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_qtd_int_ps_2 (
    dt_entrada timestamp without time zone,
    tipo_atendimento character varying(9),
    atendimento_int bigint,
    atendimento_ps double precision,
    convenio character varying(4000),
    clinica character varying(4000),
    cid character varying(4000),
    medico character varying(50),
    setor_internacao character varying(19)
);


--
-- Name: bi_producao_ps_c_qtd_internacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_producao_ps_c_qtd_internacao (
    dt_entrada timestamp without time zone,
    tipo_atendimento character varying(9),
    atendimento_int bigint,
    medico character varying(18),
    convenio character varying(4000),
    clinica character varying(4000),
    cid character varying(4000)
);


--
-- Name: bi_taxa_ocupacao_setores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_taxa_ocupacao_setores (
    cd_unidade_basica character varying(10),
    ds_setor_atendimento character varying(100),
    ds_setor character varying(100)
);


--
-- Name: bi_taxa_ocupacao_txocupacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bi_taxa_ocupacao_txocupacao (
    nr_paciente double precision,
    nr_pac_dia double precision,
    nr_admissoes double precision,
    nr_alta double precision,
    nr_obitos double precision,
    ds_setor_atendimento character varying(100),
    dt_referencia timestamp without time zone,
    empresa character varying(4000),
    ds_convenio character varying(255),
    ds_setor character varying(100),
    classificacao_setor character varying(18),
    cd_idade double precision,
    ds_faixa_etaria character varying(50),
    medico character varying(4000),
    cd_dia double precision,
    ds_classif_etaria character varying(4000),
    nm_paciente character varying(4000),
    data_nascimento timestamp without time zone,
    ie_sexo character varying(4000)
);


--
-- Name: gestao_tempo_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.gestao_tempo_ps (
    nr_atendimento bigint,
    dt_geracao_senha timestamp without time zone,
    cd_senha_gerada character varying(50),
    ds_fila_origem character varying(255),
    classificacao character varying(4000),
    dt_chamada_classif timestamp without time zone,
    local_classificacao character varying(20),
    usuario_classif character varying(4000),
    qtd_chamada_classif double precision,
    dt_chamada_recepcao timestamp without time zone,
    local_recepcao character varying(20),
    usuario_recep character varying(4000),
    qtd_chamada_recep double precision,
    dt_chamada_consultorio timestamp without time zone,
    local_consultorio character varying(20),
    usuario_consultorio character varying(4000),
    qtd_chamada_consult double precision,
    data_local_desconhec timestamp without time zone,
    local_desconhecido character varying(20),
    usuario_desc character varying(15),
    qtd_chamada_desc double precision,
    dt_inutilizacao timestamp without time zone,
    ds_justificativa_classif character varying(255),
    dt_inicio_triagem timestamp without time zone,
    paciente character varying(4000),
    dt_atendimento timestamp without time zone,
    dt_recebimento_senha timestamp without time zone,
    ie_utilizacao character varying(5),
    ds_convenio character varying(255),
    dt_alta timestamp without time zone,
    nr_sequencia bigint,
    clinica character varying(4000),
    dt_impressao timestamp without time zone
);


--


-- ------------------------------------------------------------
-- VIEWS
-- ------------------------------------------------------------

-- Name: bi_test_two; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.bi_test_two AS
 SELECT nr_atendimento
   FROM public.gestao_tempo_ps;


--
-- Name: chamados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chamados (
    id integer NOT NULL,
    numero_kora character varying(10) NOT NULL,
    nome_solicitante character varying(150) NOT NULL,
    local_problema character varying(200) NOT NULL,
    observacao_abertura text,
    data_abertura timestamp without time zone DEFAULT now() NOT NULL,
    data_visualizacao timestamp without time zone,
    tecnico_atendimento character varying(150) DEFAULT NULL::character varying,
    observacao_fechamento text,
    data_inicio_atendimento timestamp without time zone,
    data_fechamento timestamp without time zone,
    status character varying(20) DEFAULT 'aberto'::character varying NOT NULL,
    prioridade character varying(15) DEFAULT 'normal'::character varying NOT NULL,
    visualizado boolean DEFAULT false NOT NULL,
    data_atualizacao timestamp without time zone DEFAULT now() NOT NULL,
    atualizado_por character varying(150) DEFAULT NULL::character varying,
    local_id integer,
    setor character varying(150),
    hostname character varying(100),
    problema_id integer,
    problema_descricao character varying(150),
    ip character varying(15) DEFAULT NULL::character varying,
    CONSTRAINT chamados_prioridade_check CHECK (((prioridade)::text = ANY (ARRAY[('baixa'::character varying)::text, ('normal'::character varying)::text, ('alta'::character varying)::text, ('critica'::character varying)::text]))),
    CONSTRAINT chamados_status_check CHECK (((status)::text = ANY (ARRAY[('aberto'::character varying)::text, ('em_atendimento'::character varying)::text, ('fechado'::character varying)::text, ('inativo'::character varying)::text])))
);


--
-- Name: chamados_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chamados_config (
    id integer NOT NULL,
    chave character varying(50) NOT NULL,
    valor text NOT NULL,
    descricao character varying(200) DEFAULT NULL::character varying,
    data_atualizacao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: chamados_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.chamados_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chamados_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chamados_config_id_seq OWNED BY public.chamados_config.id;


--
-- Name: chamados_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chamados_historico (
    id integer NOT NULL,
    chamado_id integer NOT NULL,
    acao character varying(50) NOT NULL,
    status_anterior character varying(20) DEFAULT NULL::character varying,
    status_novo character varying(20) DEFAULT NULL::character varying,
    descricao text,
    usuario character varying(150) NOT NULL,
    data_registro timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: chamados_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.chamados_historico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chamados_historico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chamados_historico_id_seq OWNED BY public.chamados_historico.id;


--
-- Name: chamados_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.chamados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chamados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chamados_id_seq OWNED BY public.chamados.id;


--
-- Name: chamados_locais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chamados_locais (
    id integer NOT NULL,
    setor character varying(150) NOT NULL,
    local character varying(150) NOT NULL,
    hostname character varying(100) DEFAULT NULL::character varying,
    ativo boolean DEFAULT true NOT NULL,
    data_criacao timestamp without time zone DEFAULT now() NOT NULL,
    data_atualizacao timestamp without time zone DEFAULT now() NOT NULL,
    ip character varying(15) DEFAULT NULL::character varying
);


--
-- Name: chamados_locais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.chamados_locais_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chamados_locais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chamados_locais_id_seq OWNED BY public.chamados_locais.id;


--
-- Name: chamados_problemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chamados_problemas (
    id integer NOT NULL,
    descricao character varying(150) NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    data_criacao timestamp without time zone DEFAULT now() NOT NULL,
    data_atualizacao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: chamados_problemas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.chamados_problemas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chamados_problemas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chamados_problemas_id_seq OWNED BY public.chamados_problemas.id;


--
-- Name: especialidade_medica; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.especialidade_medica (
    cd_especialidade character varying(20) NOT NULL,
    ds_especialidade character varying(200) NOT NULL,
    dt_atualizacao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: evolucao_turno; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.evolucao_turno (
    id integer NOT NULL,
    nr_atendimento character varying(20) NOT NULL,
    ds_convenio character varying(100),
    nm_paciente character varying(200),
    idade character varying(10),
    dt_entrada timestamp without time zone,
    dt_alta timestamp without time zone,
    medico_responsavel character varying(200),
    medico_atendimento character varying(200),
    dias_internado integer,
    data_turno date NOT NULL,
    turno character varying(10) NOT NULL,
    setor character varying(60),
    unidade character varying(20),
    dt_admissao_unidade timestamp without time zone,
    evolucao_medica character varying(10),
    evolucao_enfermeiro character varying(10),
    evolucao_tec_enfermagem character varying(10),
    evolucao_nutricionista character varying(10),
    evolucao_fisioterapeuta character varying(10),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: evolucao_turno_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.evolucao_turno_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evolucao_turno_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evolucao_turno_id_seq OWNED BY public.evolucao_turno.id;


--
-- Name: for_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.for_tests (
    item text,
    "Month/Year Bought" timestamp without time zone,
    cost double precision
);


--
-- Name: historico_usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.historico_usuarios (
    id integer NOT NULL,
    usuario_id integer,
    acao character varying(50) NOT NULL,
    detalhes text,
    realizado_por integer,
    data_hora timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: historico_usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.historico_usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: historico_usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.historico_usuarios_id_seq OWNED BY public.historico_usuarios.id;


--
-- Name: hub_servicos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.hub_servicos (
    id integer NOT NULL,
    nome character varying(150) NOT NULL,
    descricao character varying(500),
    icone character varying(80),
    cor character varying(30) DEFAULT '#dc3545'::character varying,
    url_destino character varying(500),
    tipo character varying(50) DEFAULT 'formulario'::character varying,
    ordem integer DEFAULT 0,
    ativo boolean DEFAULT true,
    requer_login boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now(),
    permissao_requerida character varying(50) DEFAULT NULL::character varying
);


--
-- Name: hub_servicos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.hub_servicos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hub_servicos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hub_servicos_id_seq OWNED BY public.hub_servicos.id;


--
-- Name: medicos_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.medicos_ps (
    id integer NOT NULL,
    nm_usuario character varying(100),
    nm_maq_cliente character varying(100),
    consultorio character varying(50),
    ds_usuario character varying(200),
    especialidade character varying(200),
    machine character varying(100),
    logon_time timestamp without time zone,
    tempo_conectado character varying(50),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: medicos_ps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.medicos_ps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: medicos_ps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.medicos_ps_id_seq OWNED BY public.medicos_ps.id;


--
-- Name: ml_faturamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_faturamento (
    id bigint NOT NULL,
    dt_entrada date NOT NULL,
    dt_conta date,
    dt_alta date,
    dt_conta_definitiva date,
    nr_atendimento bigint NOT NULL,
    nr_interno_conta bigint,
    tipo_atendimento character varying(100),
    ds_clinica character varying(100),
    ie_clinica character varying(10),
    ds_carater_inter_sus character varying(50),
    cd_convenio integer,
    cd_setor_conta integer,
    cd_setor_paciente integer,
    ie_status_acerto smallint,
    flag_definitiva smallint DEFAULT 0 NOT NULL,
    tipo_linha character(3) NOT NULL,
    grupo_receita character varying(30),
    cd_item bigint,
    quantidade numeric(15,3),
    vl_produzido numeric(15,2),
    dt_carga timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_faturamento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_faturamento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_faturamento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_faturamento_id_seq OWNED BY public.ml_faturamento.id;


--
-- Name: ml_faturamento_predicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_faturamento_predicoes (
    id bigint NOT NULL,
    dt_alvo date NOT NULL,
    horizonte_dias smallint NOT NULL,
    segmento character varying(30) NOT NULL,
    modelo_id integer,
    modelo_nome character varying(100),
    modelo_versao character varying(20),
    valor_previsto numeric(15,2) NOT NULL,
    intervalo_inferior numeric(15,2),
    intervalo_superior numeric(15,2),
    features_usadas jsonb,
    hash_features character varying(40),
    valor_realizado numeric(15,2),
    erro_absoluto numeric(15,2),
    erro_percentual numeric(10,3),
    dt_atualizacao_real timestamp without time zone,
    dt_geracao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_faturamento_predicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_faturamento_predicoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_faturamento_predicoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_faturamento_predicoes_id_seq OWNED BY public.ml_faturamento_predicoes.id;


--
-- Name: ml_faturamento_setor_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_faturamento_setor_mapping (
    cd_setor integer NOT NULL,
    categoria_setor character varying(30) NOT NULL,
    ds_setor character varying(100),
    observacao text,
    dt_criacao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_internacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_internacoes (
    id bigint NOT NULL,
    dt_entrada date NOT NULL,
    dt_entrada_hora timestamp without time zone,
    dt_alta date,
    nr_atendimento bigint NOT NULL,
    ie_tipo_atendimento smallint DEFAULT 1 NOT NULL,
    ie_clinica smallint,
    cd_convenio integer,
    cd_setor_atendimento integer,
    cd_classif_setor character varying(10),
    hora_entrada smallint,
    dia_semana_oracle smallint,
    dias_internacao integer,
    cd_motivo_alta integer,
    idade_entrada integer,
    ie_sexo character(1),
    ie_carater_inter character varying(10),
    flag_veio_ps smallint DEFAULT 0,
    dt_carga timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_internacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_internacoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_internacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_internacoes_id_seq OWNED BY public.ml_internacoes.id;


--
-- Name: ml_internacoes_predicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_internacoes_predicoes (
    id bigint NOT NULL,
    dt_alvo date NOT NULL,
    horizonte_dias smallint NOT NULL,
    segmento character varying(30) DEFAULT 'total'::character varying NOT NULL,
    modelo_id integer,
    modelo_nome character varying(100),
    modelo_versao character varying(20),
    valor_previsto numeric(10,2) NOT NULL,
    intervalo_inferior numeric(10,2),
    intervalo_superior numeric(10,2),
    valor_realizado integer,
    erro_absoluto numeric(10,2),
    erro_percentual numeric(10,3),
    dt_atualizacao_real timestamp without time zone,
    dt_geracao timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_internacoes_predicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_internacoes_predicoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_internacoes_predicoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_internacoes_predicoes_id_seq OWNED BY public.ml_internacoes_predicoes.id;


--
-- Name: ml_modelos_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_modelos_registry (
    id integer NOT NULL,
    nome_modelo character varying(100) NOT NULL,
    versao character varying(20) NOT NULL,
    descricao text,
    categoria character varying(50),
    algoritmo character varying(50),
    caminho_pkl character varying(255) NOT NULL,
    caminho_metadata character varying(255),
    dt_treino timestamp without time zone DEFAULT now(),
    periodo_treino_inicio date,
    periodo_treino_fim date,
    num_amostras_treino integer,
    mae_teste numeric(10,3),
    mape_teste numeric(6,3),
    rmse_teste numeric(10,3),
    metricas_completas jsonb,
    num_features integer,
    features_lista jsonb,
    hiperparametros jsonb,
    status character varying(20) DEFAULT 'desenvolvimento'::character varying,
    ie_ativo boolean DEFAULT true,
    criado_por character varying(60),
    dt_criacao timestamp without time zone DEFAULT now(),
    dt_atualizacao timestamp without time zone DEFAULT now(),
    observacoes text
);


--
-- Name: ml_modelos_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_modelos_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_modelos_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_modelos_registry_id_seq OWNED BY public.ml_modelos_registry.id;


--
-- Name: ml_ps_historico_chegadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_ps_historico_chegadas (
    nr_atendimento bigint NOT NULL,
    dt_entrada timestamp without time zone NOT NULL,
    dt_entrada_str character varying(19),
    ano_entrada smallint,
    mes_entrada smallint,
    dia_entrada smallint,
    hora_entrada smallint,
    min_entrada smallint,
    dia_semana smallint,
    nm_dia_semana character varying(15),
    cd_setor_atendimento integer,
    ds_setor_atendimento character varying(100),
    ie_prioridade integer,
    ds_triagem character varying(60),
    dt_fim_triagem timestamp without time zone,
    ds_nivel_urgencia character varying(100),
    ie_sexo character(1),
    qt_idade smallint,
    dt_nascimento date,
    cd_pessoa_fisica character varying(10),
    ds_convenio character varying(255),
    ie_clinica integer,
    ds_clinica character varying(60),
    dt_inicio_atendimento timestamp without time zone,
    dt_atend_medico timestamp without time zone,
    dt_fim_consulta timestamp without time zone,
    dt_alta timestamp without time zone,
    dt_cancelamento timestamp without time zone,
    ie_status character varying(10),
    ie_internado character(1),
    cd_cid_principal character varying(10),
    cd_cid_secundario character varying(10),
    ds_bairro character varying(40),
    cd_municipio_ibge character varying(6),
    ie_cancelado character(1),
    dt_extracao timestamp without time zone DEFAULT now(),
    dt_carga_pg timestamp without time zone DEFAULT now()
);


--
-- Name: ml_ps_metricas_diarias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_ps_metricas_diarias (
    id integer NOT NULL,
    dt_calculo date NOT NULL,
    modelo_id integer,
    modelo_nome character varying(100) NOT NULL,
    modelo_versao character varying(20) NOT NULL,
    janela_dias smallint NOT NULL,
    dt_janela_inicio date,
    dt_janela_fim date,
    num_predicoes integer,
    mae numeric(10,3),
    mape numeric(6,3),
    rmse numeric(10,3),
    bias numeric(10,3),
    mae_baseline numeric(10,3),
    drift_pct numeric(6,3),
    status_saude character varying(20),
    dt_calculo_completo timestamp without time zone DEFAULT now(),
    detalhes jsonb
);


--
-- Name: ml_ps_metricas_diarias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_ps_metricas_diarias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_ps_metricas_diarias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_ps_metricas_diarias_id_seq OWNED BY public.ml_ps_metricas_diarias.id;


--
-- Name: ml_ps_predicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ml_ps_predicoes (
    id bigint NOT NULL,
    dt_geracao timestamp without time zone DEFAULT now() NOT NULL,
    dt_alvo date NOT NULL,
    horizonte_dias smallint,
    valor_previsto numeric(10,2) NOT NULL,
    intervalo_inferior numeric(10,2),
    intervalo_superior numeric(10,2),
    modelo_id integer,
    modelo_nome character varying(100) NOT NULL,
    modelo_versao character varying(20) NOT NULL,
    features_usadas jsonb,
    hash_features character varying(64),
    valor_realizado numeric(10,2),
    erro_absoluto numeric(10,2),
    erro_percentual numeric(10,3),
    dt_atualizacao_real timestamp without time zone,
    ie_ativo boolean DEFAULT true,
    observacoes text
);


--
-- Name: ml_ps_predicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ml_ps_predicoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_ps_predicoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_ps_predicoes_id_seq OWNED BY public.ml_ps_predicoes.id;


--
-- Name: n8n_parecer_medicos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.n8n_parecer_medicos (
    nr_parecer integer,
    nr_atendimento integer,
    nm_medico character varying(4000),
    dt_liberacao character varying(4000),
    especialidade_origem character varying(4000),
    especialidade_destino character varying(4000),
    parecer_raw character varying,
    crm character varying,
    paciente character varying,
    parecer_clean character varying
);


--
-- Name: notificacoes_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_config (
    id integer NOT NULL,
    tipo_evento character varying(50) NOT NULL,
    descricao character varying(200),
    topico_ntfy character varying(100) NOT NULL,
    url_servidor character varying(300) DEFAULT 'https://ntfy.sh'::character varying NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    hora_inicio time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    hora_fim time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
    intervalo_renotificacao_min integer DEFAULT 60 NOT NULL,
    max_renotificacoes integer DEFAULT 3 NOT NULL,
    prioridade_ntfy integer DEFAULT 3 NOT NULL,
    tags_ntfy character varying(100),
    titulo_template character varying(200),
    mensagem_template text,
    dt_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_horario CHECK ((hora_inicio < hora_fim)),
    CONSTRAINT chk_intervalo CHECK ((intervalo_renotificacao_min >= 0)),
    CONSTRAINT chk_max_renotif CHECK ((max_renotificacoes >= 0)),
    CONSTRAINT chk_prioridade CHECK (((prioridade_ntfy >= 1) AND (prioridade_ntfy <= 5)))
);


--
-- Name: notificacoes_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_config_id_seq OWNED BY public.notificacoes_config.id;


--
-- Name: notificacoes_destinatarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_destinatarios (
    id integer NOT NULL,
    tipo_evento character varying(50) NOT NULL,
    nome character varying(200) NOT NULL,
    email character varying(200) NOT NULL,
    especialidade character varying(100),
    setor character varying(100),
    ativo boolean DEFAULT true NOT NULL,
    dt_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    canal character varying(20) DEFAULT 'email'::character varying,
    descricao character varying(300),
    criado_por character varying(100),
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    destino character varying(200)
);


--
-- Name: notificacoes_destinatarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_destinatarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_destinatarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_destinatarios_id_seq OWNED BY public.notificacoes_destinatarios.id;


--
-- Name: notificacoes_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_historico (
    id integer NOT NULL,
    tipo_evento character varying(50) NOT NULL,
    titulo character varying(300),
    destinatarios_emails text,
    qt_destinatarios integer DEFAULT 0,
    canal character varying(20) DEFAULT 'email'::character varying,
    sucesso boolean DEFAULT false,
    erro_mensagem text,
    dados_resumo jsonb,
    dt_envio timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notificacoes_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_historico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_historico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_historico_id_seq OWNED BY public.notificacoes_historico.id;


--
-- Name: notificacoes_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_log (
    id integer NOT NULL,
    tipo_evento character varying(50) NOT NULL,
    chave_evento character varying(100) NOT NULL,
    nr_atendimento bigint,
    nm_paciente character varying(200),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    cd_unidade character varying(20),
    dados_extra jsonb,
    topico_ntfy character varying(100),
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    dt_detectado timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    dt_primeira_notificacao timestamp without time zone,
    dt_ultima_notificacao timestamp without time zone,
    qt_notificacoes integer DEFAULT 0 NOT NULL,
    dt_resolvido timestamp without time zone,
    resposta_ntfy text,
    dt_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_status CHECK (((status)::text = ANY (ARRAY[('pendente'::character varying)::text, ('notificado'::character varying)::text, ('resolvido'::character varying)::text, ('erro'::character varying)::text, ('expirado'::character varying)::text])))
);


--
-- Name: notificacoes_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_log_id_seq OWNED BY public.notificacoes_log.id;


--
-- Name: notificacoes_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_snapshot (
    id integer NOT NULL,
    tipo_snapshot character varying(50) NOT NULL,
    nr_atendimento bigint NOT NULL,
    dados_snapshot jsonb,
    dt_snapshot timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: notificacoes_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_snapshot_id_seq OWNED BY public.notificacoes_snapshot.id;


--
-- Name: notificacoes_tipos_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes_tipos_evento (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nome character varying(200) NOT NULL,
    descricao text,
    icone character varying(50) DEFAULT 'fa-bell'::character varying,
    cor character varying(20) DEFAULT '#dc3545'::character varying,
    tabela_origem character varying(100),
    ativo boolean DEFAULT true NOT NULL,
    dt_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notificacoes_tipos_evento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.notificacoes_tipos_evento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificacoes_tipos_evento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificacoes_tipos_evento_id_seq OWNED BY public.notificacoes_tipos_evento.id;


--
-- Name: nutricao_cadastros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.nutricao_cadastros (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    matricula character varying(50),
    funcao character varying(30) DEFAULT 'tecnico'::character varying,
    turno character varying(20) DEFAULT 'todos'::character varying,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now()
);


--
-- Name: nutricao_cadastros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.nutricao_cadastros_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutricao_cadastros_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutricao_cadastros_id_seq OWNED BY public.nutricao_cadastros.id;


--
-- Name: nutricao_refeicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.nutricao_refeicoes (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    horario_inicio time without time zone,
    horario_fim time without time zone,
    icone character varying(50) DEFAULT 'fa-clock'::character varying,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0
);


--
-- Name: nutricao_refeicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.nutricao_refeicoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutricao_refeicoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutricao_refeicoes_id_seq OWNED BY public.nutricao_refeicoes.id;


--
-- Name: nutricao_restricoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.nutricao_restricoes (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    sigla character varying(20),
    icone character varying(50) DEFAULT 'fa-triangle-exclamation'::character varying,
    cor character varying(20) DEFAULT '#E67E00'::character varying,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0
);


--
-- Name: nutricao_restricoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.nutricao_restricoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutricao_restricoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutricao_restricoes_id_seq OWNED BY public.nutricao_restricoes.id;


--
-- Name: nutricao_solicitacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.nutricao_solicitacoes (
    id integer NOT NULL,
    codigo_entrega character varying(25) NOT NULL,
    nr_atendimento character varying(50) NOT NULL,
    nm_paciente character varying(200) NOT NULL,
    leito character varying(50),
    setor_nome character varying(200),
    cd_unidade character varying(20),
    ds_clinica character varying(200),
    tipo_dieta_id integer,
    tipo_dieta_nome character varying(100),
    refeicao_id integer,
    refeicao_nome character varying(100),
    quantidade integer DEFAULT 1,
    restricoes text,
    observacao text,
    prioridade character varying(20) DEFAULT 'normal'::character varying,
    status character varying(30) DEFAULT 'aguardando'::character varying,
    solicitante_id integer,
    solicitante_nome character varying(200),
    responsavel_id integer,
    responsavel_nome character varying(200),
    entregue_por character varying(200),
    criado_em timestamp without time zone DEFAULT now(),
    dt_aceite timestamp without time zone,
    dt_inicio_preparo timestamp without time zone,
    dt_pronto timestamp without time zone,
    dt_inicio_entrega timestamp without time zone,
    dt_entrega timestamp without time zone,
    dt_cancelamento timestamp without time zone,
    motivo_cancelamento text,
    observacao_entrega text,
    atualizado_em timestamp without time zone DEFAULT now()
);


--
-- Name: nutricao_solicitacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.nutricao_solicitacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutricao_solicitacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutricao_solicitacoes_id_seq OWNED BY public.nutricao_solicitacoes.id;


--
-- Name: nutricao_tipos_dieta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.nutricao_tipos_dieta (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    descricao text,
    icone character varying(50) DEFAULT 'fa-utensils'::character varying,
    cor character varying(20) DEFAULT '#17A2B8'::character varying,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0,
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: nutricao_tipos_dieta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.nutricao_tipos_dieta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutricao_tipos_dieta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutricao_tipos_dieta_id_seq OWNED BY public.nutricao_tipos_dieta.id;


--
-- Name: ocupacao_hospitalar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ocupacao_hospitalar (
    id integer NOT NULL,
    nr_atendimento character varying(50),
    dt_entrada_unidade timestamp without time zone,
    dt_entrada_unid character varying(50),
    cd_unidade character varying(20),
    cd_unidade_basica character varying(20),
    nm_pessoa_fisica character varying(200),
    cd_setor_atendimento integer,
    "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" character varying(200),
    dt_nascimento date,
    ie_sexo character(1),
    ds_convenio character varying(200),
    nr_crm character varying(20),
    nm_guerra character varying(200),
    qt_dia_permanencia numeric,
    ds_clinica character varying(200),
    dt_alta_medico timestamp without time zone,
    ds_tipo_acomodacao character varying(100),
    classif character varying(50),
    ie_status_unidade character(1),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ie_temporario character(1) DEFAULT 'N'::bpchar
);


--
-- Name: ocupacao_hospitalar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.ocupacao_hospitalar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ocupacao_hospitalar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ocupacao_hospitalar_id_seq OWNED BY public.ocupacao_hospitalar.id;


--
-- Name: p27_exames_lab; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.p27_exames_lab (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    cd_exame integer NOT NULL,
    nm_exame character varying(50) NOT NULL,
    resultado_texto character varying(50),
    resultado_numerico numeric(12,4),
    nr_prescricao bigint,
    dt_solicitacao character varying(20),
    dt_coleta character varying(20),
    dt_resultado character varying(20),
    rn_recencia integer,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: p27_exames_lab_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.p27_exames_lab_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p27_exames_lab_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p27_exames_lab_id_seq OWNED BY public.p27_exames_lab.id;


--
-- Name: p27_historico_exames; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.p27_historico_exames (
    id integer NOT NULL,
    dt_registro timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    nr_atendimento bigint NOT NULL,
    cd_exame integer NOT NULL,
    nm_exame character varying(50),
    resultado_texto character varying(50),
    resultado_numerico numeric(12,4),
    nr_prescricao bigint,
    dt_coleta character varying(20),
    dt_resultado character varying(20)
);


--
-- Name: p27_historico_exames_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.p27_historico_exames_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p27_historico_exames_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p27_historico_exames_id_seq OWNED BY public.p27_historico_exames.id;


--
-- Name: p27_historico_sinais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.p27_historico_sinais (
    id integer NOT NULL,
    dt_registro timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    nr_atendimento bigint NOT NULL,
    pa_sistolica numeric(6,1),
    pa_diastolica numeric(6,1),
    pam numeric(6,1),
    freq_cardiaca numeric(6,1),
    freq_resp numeric(6,1),
    temperatura numeric(4,1),
    saturacao_o2 numeric(5,1),
    glicemia_capilar numeric(6,1),
    escala_dor numeric(4,1)
);


--
-- Name: p27_historico_sinais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.p27_historico_sinais_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p27_historico_sinais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p27_historico_sinais_id_seq OWNED BY public.p27_historico_sinais.id;


--
-- Name: p27_pacientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.p27_pacientes (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    cd_paciente character varying(20),
    nm_paciente character varying(200),
    idade character varying(30),
    ie_sexo character varying(2),
    nr_prontuario bigint,
    convenio character varying(200),
    nm_medico_resp character varying(200),
    cd_cid_principal character varying(20),
    ds_clinica character varying(100),
    ie_tipo_atendimento integer,
    ds_tipo_atendimento character varying(100),
    dt_entrada_hosp character varying(20),
    dt_alta character varying(20),
    ds_motivo_alta character varying(200),
    status_paciente character varying(20),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    cd_leito character varying(20),
    cd_unidade_basica character varying(20),
    clinica_setor character varying(100),
    dias_internacao integer,
    dt_ultimo_sinal_vital character varying(20),
    pa_sistolica numeric(6,1),
    pa_diastolica numeric(6,1),
    pam numeric(6,1),
    freq_cardiaca numeric(6,1),
    freq_resp numeric(6,1),
    temperatura numeric(4,1),
    saturacao_o2 numeric(5,1),
    peso numeric(6,2),
    imc numeric(5,1),
    glicemia_capilar numeric(6,1),
    escala_dor numeric(4,1),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: p27_pacientes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.p27_pacientes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p27_pacientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p27_pacientes_id_seq OWNED BY public.p27_pacientes.id;


--
-- Name: padioleiro_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 2147483647
    CACHE 1;


--
-- Name: padioleiro; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro (
    id integer DEFAULT nextval('public.padioleiro_id_seq'::regclass) NOT NULL,
    nr_atendimento character varying(50),
    dt_entrada_unidade timestamp without time zone,
    dt_entrada timestamp without time zone,
    cd_unidade character varying(20),
    cd_unidade_basica character varying(20),
    nm_pessoa_fisica character varying(200),
    cd_setor_atendimento integer,
    setor character varying(200),
    dt_nascimento date,
    ie_sexo character(1),
    ds_convenio character varying(200),
    nr_crm character varying(20),
    nm_guerra character varying(200),
    qt_dia_permanencia numeric,
    ds_clinica character varying(200),
    dt_alta_medico timestamp without time zone,
    ds_tipo_acomodacao character varying(100),
    classif character varying(50),
    ie_status_unidade character(1),
    ie_temporario character(1),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: padioleiro_cadastros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro_cadastros (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    matricula character varying(50),
    turno character varying(20) DEFAULT 'todos'::character varying,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    atualizado_em timestamp without time zone
);


--
-- Name: padioleiro_cadastros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_cadastros_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: padioleiro_cadastros_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.padioleiro_cadastros_id_seq OWNED BY public.padioleiro_cadastros.id;


--
-- Name: padioleiro_chamados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro_chamados (
    id integer NOT NULL,
    tipo_movimento_id integer,
    tipo_movimento_nome character varying(100),
    nm_paciente character varying(200),
    nr_atendimento character varying(50),
    leito_origem character varying(50),
    setor_origem_nome character varying(200),
    destino_nome character varying(200),
    destino_complemento character varying(200),
    observacao text,
    prioridade character varying(20) DEFAULT 'normal'::character varying,
    status character varying(30) DEFAULT 'aguardando'::character varying,
    solicitante_id integer,
    solicitante_nome character varying(200),
    padioleiro_id integer,
    padioleiro_nome character varying(200),
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dt_aceite timestamp without time zone,
    dt_inicio_transporte timestamp without time zone,
    dt_conclusao timestamp without time zone,
    dt_cancelamento timestamp without time zone,
    motivo_cancelamento text,
    atualizado_em timestamp without time zone
);


--
-- Name: padioleiro_chamados_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_chamados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: padioleiro_chamados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.padioleiro_chamados_id_seq OWNED BY public.padioleiro_chamados.id;


--
-- Name: padioleiro_destinos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro_destinos (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    tipo_movimento_id integer,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0
);


--
-- Name: padioleiro_destinos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_destinos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: padioleiro_destinos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.padioleiro_destinos_id_seq OWNED BY public.padioleiro_destinos.id;


--
-- Name: padioleiro_origens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro_origens (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0
);


--
-- Name: padioleiro_origens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_origens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: padioleiro_origens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.padioleiro_origens_id_seq OWNED BY public.padioleiro_origens.id;


--
-- Name: padioleiro_tipos_movimento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.padioleiro_tipos_movimento (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    icone character varying(50) DEFAULT 'fa-ambulance'::character varying,
    cor character varying(20) DEFAULT '#dc3545'::character varying,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0
);


--
-- Name: padioleiro_tipos_movimento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.padioleiro_tipos_movimento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: padioleiro_tipos_movimento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.padioleiro_tipos_movimento_id_seq OWNED BY public.padioleiro_tipos_movimento.id;


--
-- Name: painel16_atendimentos_dia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel16_atendimentos_dia (
    id integer NOT NULL,
    nr_atendimento integer,
    dt_entrada timestamp without time zone,
    dt_alta timestamp without time zone,
    cd_motivo_alta integer,
    ds_motivo_alta character varying(200),
    usuario character varying(100),
    usuario_atendimento character varying(200),
    cd_tipo_atendimento integer,
    ds_tipo_atendimento character varying(100),
    ds_convenio character varying(200),
    nm_medico character varying(200),
    nm_paciente character varying(200),
    ds_idade character varying(50),
    nr_anos integer,
    sexo character varying(20),
    data_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    plantao_noturno character varying(1) DEFAULT 'N'::character varying,
    dt_inicio_atend_recepcao timestamp without time zone,
    dt_fim_atend_recepcao timestamp without time zone,
    tempo_atend_recepcao_min numeric(8,1),
    ds_usuario character varying(255)
);


--
-- Name: painel16_atendimentos_dia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel16_atendimentos_dia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel16_atendimentos_dia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel16_atendimentos_dia_id_seq OWNED BY public.painel16_atendimentos_dia.id;


--
-- Name: painel16_maquinas_recepcao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel16_maquinas_recepcao (
    id integer NOT NULL,
    nm_usuario character varying(100),
    nm_maq_cliente character varying(100),
    consultorio character varying(50),
    ds_usuario character varying(200),
    especialidade character varying(200),
    machine character varying(100),
    logon_time timestamp without time zone,
    tempo_conectado character varying(50),
    setor character varying(20),
    data_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel16_maquinas_recepcao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel16_maquinas_recepcao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel16_maquinas_recepcao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel16_maquinas_recepcao_id_seq OWNED BY public.painel16_maquinas_recepcao.id;


--
-- Name: painel17_atendimentos_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel17_atendimentos_ps (
    id integer NOT NULL,
    nr_atendimento integer NOT NULL,
    clinica character varying(100),
    cd_clinica integer,
    dt_entrada timestamp without time zone,
    dt_alta timestamp without time zone,
    cd_motivo_alta integer,
    ds_motivo_alta character varying(200),
    usuario character varying(100),
    usuario_atendimento character varying(200),
    cd_tipo_atendimento integer,
    ds_tipo_atendimento character varying(100),
    ds_convenio character varying(200),
    nm_medico character varying(200),
    nm_paciente character varying(200),
    ds_idade character varying(50),
    nr_anos numeric,
    sexo character varying(20),
    plantao_noturno character varying(1) DEFAULT 'N'::character varying,
    inicio_atendimento_recep timestamp without time zone,
    dt_inicio_atendimento_med timestamp without time zone,
    inicio_consulta character varying(10),
    dt_fim_atendimento timestamp without time zone,
    fim_consulta character varying(10),
    hr_lib_medico character varying(10),
    hr_espera character varying(10),
    hr_pa character varying(10),
    hr_medicacao character varying(10),
    retirada_senha timestamp without time zone,
    hr_espera_senha character varying(10),
    data_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dt_inicio_atendimento timestamp without time zone
);


--
-- Name: painel17_atendimentos_ps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel17_atendimentos_ps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel17_atendimentos_ps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel17_atendimentos_ps_id_seq OWNED BY public.painel17_atendimentos_ps.id;


--
-- Name: painel19_radiologia_pendencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel19_radiologia_pendencias (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    leito character varying(20),
    leito_base character varying(20),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    nm_pessoa_fisica character varying(255),
    idade integer,
    ds_convenio character varying(255),
    ds_tipo_acomodacao character varying(100),
    nr_prescricao bigint,
    nr_seq_procedimento integer,
    cd_procedimento bigint,
    ds_procedimento character varying(200),
    nm_medico_solicitante character varying(120),
    dt_pedido timestamp without time zone,
    dt_prev_execucao timestamp without time zone,
    ds_status_execucao character varying(60),
    dt_execucao timestamp without time zone,
    nm_executor character varying(120),
    dt_laudo timestamp without time zone,
    dt_laudo_liberacao timestamp without time zone,
    nm_laudador character varying(120),
    ie_status_laudo character varying(10),
    status_radiologia character varying(30) NOT NULL,
    prioridade_ordem smallint NOT NULL,
    horas_espera numeric(8,1),
    ie_urgente character(1) DEFAULT 'N'::bpchar,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel19_radiologia_pendencias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel19_radiologia_pendencias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel19_radiologia_pendencias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel19_radiologia_pendencias_id_seq OWNED BY public.painel19_radiologia_pendencias.id;


--
-- Name: painel20_radiologia_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel20_radiologia_ps (
    nr_atendimento bigint NOT NULL,
    dt_entrada timestamp without time zone,
    horas_no_ps numeric(10,1),
    nm_pessoa_fisica character varying(120),
    idade integer,
    ds_convenio character varying(120),
    nm_medico_responsavel character varying(60),
    nr_prescricao bigint NOT NULL,
    nr_seq_procedimento integer NOT NULL,
    cd_procedimento bigint,
    ds_procedimento character varying(120),
    nm_medico_solicitante character varying(60),
    dt_pedido timestamp without time zone,
    dt_prev_execucao timestamp without time zone,
    ds_status_execucao character varying(60),
    dt_execucao timestamp without time zone,
    nm_executor character varying(60),
    dt_laudo timestamp without time zone,
    dt_laudo_liberacao timestamp without time zone,
    nm_laudador character varying(60),
    ie_status_laudo character varying(10),
    status_radiologia character varying(30) NOT NULL,
    prioridade_ordem integer NOT NULL,
    horas_espera numeric(10,1),
    ie_urgente character(1) DEFAULT 'N'::bpchar,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel21_contas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel21_contas (
    id integer NOT NULL,
    nr_conta bigint NOT NULL,
    nr_atendimento bigint NOT NULL,
    estabelecimento character varying(80),
    pessoa_fisica character varying(60),
    tipo_atend character varying(80),
    ie_tipo smallint,
    status_conta character varying(20),
    legenda_conta character varying(30),
    convenio character varying(40),
    protocolo character varying(30),
    status_protocolo character varying(20),
    entrega_convenio character varying(10),
    vl_conta numeric(15,2) DEFAULT 0,
    dt_conta timestamp without time zone,
    dt_periodo_inicial timestamp without time zone,
    dt_periodo_final timestamp without time zone,
    dt_mesano_referencia timestamp without time zone,
    nr_seq_etapa integer,
    etapa_conta character varying(254),
    cd_setor_atendimento integer,
    setor_atendimento character varying(200),
    auditoria character varying(255),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel21_contas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel21_contas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel21_contas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel21_contas_id_seq OWNED BY public.painel21_contas.id;


--
-- Name: painel22_exames_ps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel22_exames_ps (
    id integer NOT NULL,
    nr_atendimento character varying(20) NOT NULL,
    dt_entrada timestamp without time zone,
    horas_no_ps numeric(6,1),
    nm_pessoa_fisica character varying(120),
    idade integer,
    ds_convenio character varying(100),
    tipo_exame character varying(20) NOT NULL,
    nr_prescricao character varying(20),
    nr_seq_procedimento integer,
    ds_procedimento character varying(120),
    ds_material character varying(100),
    dt_pedido timestamp without time zone,
    dt_coleta_execucao timestamp without time zone,
    dt_resultado timestamp without time zone,
    status_exame character varying(30) NOT NULL,
    ds_status character varying(100),
    horas_espera numeric(6,1),
    prioridade_ordem integer DEFAULT 1,
    dt_carga timestamp without time zone DEFAULT now(),
    nm_medico character varying(120),
    ds_clinica character varying(100)
);


--
-- Name: painel22_exames_ps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel22_exames_ps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel22_exames_ps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel22_exames_ps_id_seq OWNED BY public.painel22_exames_ps.id;


--
-- Name: painel23_atendimentos_amb; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel23_atendimentos_amb (
    id integer NOT NULL,
    id_atendimento bigint NOT NULL,
    paciente character varying(60),
    idade numeric,
    sexo character varying(20),
    convenio character varying(100),
    especialidade character varying(60),
    medico character varying(80),
    dt_geracao_senha timestamp without time zone,
    nr_seq_fila bigint,
    ds_fila character varying(100),
    cd_senha_gerada bigint,
    dt_chamada_recepcao timestamp without time zone,
    dt_abertura_atendimento timestamp without time zone,
    dt_inicio_consulta timestamp without time zone,
    dt_liberacao_anamnese timestamp without time zone,
    dt_fim_consulta timestamp without time zone,
    dt_final_atend_ambulatorio timestamp without time zone,
    dt_alta timestamp without time zone,
    tempo_senha_recepcao_min numeric,
    tempo_senha_abertura_min numeric,
    tempo_espera_medico_min numeric,
    tempo_consulta_min numeric,
    tempo_senha_consulta_min numeric,
    tempo_total_min numeric,
    motivo_alta character varying(60),
    cid character varying(200),
    conversao character varying(3),
    nr_atend_internacao bigint,
    producao character varying(50),
    ds_senha_qmatic character varying(20)
);


--
-- Name: painel23_atendimentos_amb_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel23_atendimentos_amb_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel23_atendimentos_amb_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel23_atendimentos_amb_id_seq OWNED BY public.painel23_atendimentos_amb.id;


--
-- Name: painel23_dashboard_v; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.painel23_dashboard_v AS
 SELECT especialidade,
    count(*) AS total_atendimentos,
    count(*) FILTER (WHERE ((dt_inicio_consulta IS NULL) AND (dt_alta IS NULL))) AS aguardando_medico,
    count(*) FILTER (WHERE ((dt_inicio_consulta IS NOT NULL) AND (dt_fim_consulta IS NULL) AND (dt_alta IS NULL))) AS em_consulta,
    count(*) FILTER (WHERE ((dt_fim_consulta IS NOT NULL) OR (dt_alta IS NOT NULL))) AS finalizados,
    count(DISTINCT medico) FILTER (WHERE ((dt_inicio_consulta IS NOT NULL) AND (dt_fim_consulta IS NULL) AND (dt_alta IS NULL))) AS medicos_atendendo,
    count(DISTINCT medico) AS medicos_total,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((tempo_senha_recepcao_min)::double precision)) FILTER (WHERE (tempo_senha_recepcao_min > (0)::numeric)) AS mediana_senha_recepcao,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((tempo_espera_medico_min)::double precision)) FILTER (WHERE ((tempo_espera_medico_min > (0)::numeric) AND (tempo_espera_medico_min < (300)::numeric))) AS mediana_espera_medico,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((tempo_consulta_min)::double precision)) FILTER (WHERE ((tempo_consulta_min > (0)::numeric) AND (tempo_consulta_min < (300)::numeric))) AS mediana_consulta,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((tempo_senha_consulta_min)::double precision)) FILTER (WHERE ((tempo_senha_consulta_min > (0)::numeric) AND (tempo_senha_consulta_min < (300)::numeric))) AS mediana_senha_consulta,
    percentile_cont((0.25)::double precision) WITHIN GROUP (ORDER BY ((tempo_espera_medico_min)::double precision)) FILTER (WHERE ((tempo_espera_medico_min > (0)::numeric) AND (tempo_espera_medico_min < (300)::numeric))) AS p25_espera_medico,
    percentile_cont((0.75)::double precision) WITHIN GROUP (ORDER BY ((tempo_espera_medico_min)::double precision)) FILTER (WHERE ((tempo_espera_medico_min > (0)::numeric) AND (tempo_espera_medico_min < (300)::numeric))) AS p75_espera_medico,
    COALESCE(sum((producao)::numeric), (0)::numeric) AS producao_total,
    count(*) FILTER (WHERE ((conversao)::text = 'SIM'::text)) AS conversoes
   FROM public.painel23_atendimentos_amb
  WHERE (dt_abertura_atendimento >= CURRENT_DATE)
  GROUP BY especialidade
  ORDER BY (count(*)) DESC;


--
-- Name: painel23_detalhe_v; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.painel23_detalhe_v AS
 SELECT id,
    id_atendimento,
    paciente,
    idade,
    sexo,
    convenio,
    especialidade,
    medico,
    dt_geracao_senha,
    nr_seq_fila,
    ds_fila,
    cd_senha_gerada,
    dt_chamada_recepcao,
    dt_abertura_atendimento,
    dt_inicio_consulta,
    dt_liberacao_anamnese,
    dt_fim_consulta,
    dt_final_atend_ambulatorio,
    dt_alta,
    tempo_senha_recepcao_min,
    tempo_senha_abertura_min,
    tempo_espera_medico_min,
    tempo_consulta_min,
    tempo_senha_consulta_min,
    tempo_total_min,
    motivo_alta,
    cid,
    conversao,
    nr_atend_internacao,
    producao,
    ds_senha_qmatic,
    COALESCE(dt_geracao_senha, dt_abertura_atendimento) AS dt_inicio_jornada,
        CASE
            WHEN (dt_alta IS NOT NULL) THEN 'ALTA'::text
            WHEN (dt_fim_consulta IS NOT NULL) THEN 'CONSULTA_FINALIZADA'::text
            WHEN (dt_inicio_consulta IS NOT NULL) THEN 'EM_CONSULTA'::text
            WHEN ((dt_abertura_atendimento IS NOT NULL) AND (dt_inicio_consulta IS NULL)) THEN 'AGUARDANDO_MEDICO'::text
            WHEN ((dt_chamada_recepcao IS NOT NULL) AND (dt_abertura_atendimento IS NULL)) THEN 'EM_RECEPCAO'::text
            WHEN ((dt_geracao_senha IS NOT NULL) AND (dt_chamada_recepcao IS NULL)) THEN 'AGUARDANDO_RECEPCAO'::text
            ELSE 'INDEFINIDO'::text
        END AS status_atendimento,
        CASE
            WHEN ((dt_inicio_consulta IS NULL) AND (dt_alta IS NULL) AND (dt_abertura_atendimento IS NOT NULL)) THEN round((EXTRACT(epoch FROM (now() - (COALESCE(dt_geracao_senha, dt_abertura_atendimento))::timestamp with time zone)) / 60.0), 1)
            ELSE NULL::numeric
        END AS tempo_espera_atual_min
   FROM public.painel23_atendimentos_amb;


--
-- Name: painel24_estoque_dia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel24_estoque_dia (
    id integer NOT NULL,
    mes_estoque character varying(7) NOT NULL,
    cd_local_estoque integer NOT NULL,
    local_estoque character varying(150) NOT NULL,
    grupo character varying(150),
    subgrupo character varying(150),
    codigo_material integer NOT NULL,
    item character varying(300) NOT NULL,
    consumo_dia numeric(18,4) DEFAULT 0,
    saldo_disponivel numeric(18,4) DEFAULT 0,
    dias_estoque numeric(18,4),
    cd_local_origem integer,
    local_origem_sugerido character varying(150),
    saldo_origem numeric(18,4),
    dias_estoque_origem numeric(18,4),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel24_estoque_dia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel24_estoque_dia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel24_estoque_dia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel24_estoque_dia_id_seq OWNED BY public.painel24_estoque_dia.id;


--
-- Name: painel25_ps_exames_medico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel25_ps_exames_medico (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    dt_entrada timestamp without time zone,
    nm_pessoa_fisica character varying(255),
    idade integer,
    ie_sexo character(1),
    ds_convenio character varying(255),
    cd_medico_resp character varying(20),
    nm_medico_resp character varying(255),
    ds_clinica character varying(255),
    cd_cid_principal character varying(20),
    nr_seq_classificacao integer,
    tipo_exame character varying(20) NOT NULL,
    nr_prescricao bigint,
    nr_seq_procedimento integer,
    ds_procedimento character varying(255),
    ds_material character varying(255),
    dt_pedido timestamp without time zone,
    dt_coleta_execucao timestamp without time zone,
    dt_resultado timestamp without time zone,
    status_exame character varying(30) NOT NULL,
    ds_status character varying(120),
    tempo_no_ps character varying(20),
    tempo_espera character varying(20),
    prioridade_ordem integer,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel25_ps_exames_medico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel25_ps_exames_medico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel25_ps_exames_medico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel25_ps_exames_medico_id_seq OWNED BY public.painel25_ps_exames_medico.id;


--
-- Name: painel33_autorizacao_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_autorizacao_documentos (
    nr_sequencia bigint NOT NULL,
    nr_sequencia_autor bigint NOT NULL,
    ds_arquivo character varying(500),
    ds_arquivo_grid character varying(200),
    nr_seq_tipo integer,
    ds_tipo_anexo character varying(120),
    ie_tipo_documento_tiss character varying(10),
    ds_tipo_documento_tiss character varying(120),
    ie_anexar_email character(1),
    ds_observacao character varying(500),
    ie_anexo_agenda character varying(10),
    ds_erro_comunicacao character varying(255),
    nr_protoc_rec_operadora character varying(120),
    ds_observacao_operadora character varying(255),
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    dt_atualizacao_nrec timestamp without time zone,
    nm_usuario_nrec character varying(60),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_autorizacao_materiais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_autorizacao_materiais (
    nr_sequencia bigint NOT NULL,
    nr_sequencia_autor bigint NOT NULL,
    nr_atendimento bigint,
    nr_seq_autorizacao bigint,
    cd_material character varying(30),
    cd_material_tuss character varying(30),
    ds_material character varying(150),
    vl_unitario numeric(15,4),
    qt_solicitada numeric(15,4),
    qt_autorizada numeric(15,4),
    vl_total numeric(15,4),
    ds_observacao character varying(500),
    ds_status_ops character varying(150),
    qt_autorizada_ops character varying(30),
    nr_prescricao bigint,
    nr_seq_prescricao integer,
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    ie_item_glosa_tiss character varying(10),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_autorizacao_procedimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_autorizacao_procedimentos (
    nr_sequencia bigint NOT NULL,
    nr_sequencia_autor bigint NOT NULL,
    nr_atendimento bigint,
    nr_seq_autorizacao bigint,
    cd_procedimento bigint,
    cd_procedimento_tuss bigint,
    ie_origem_proced integer,
    nr_seq_proc_interno integer,
    ds_procedimento character varying(200),
    ds_procedimento_tuss character varying(200),
    qt_solicitada numeric(15,4),
    qt_autorizada numeric(15,4),
    ds_observacao character varying(500),
    dt_exec_procedimento timestamp without time zone,
    ds_status_pls character varying(150),
    qt_autorizada_ops character varying(30),
    ie_lado character varying(10),
    ds_lado character varying(30),
    nr_prescricao bigint,
    nr_seq_prescricao integer,
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    ie_item_glosa_tiss character varying(10),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_autorizacoes_convenio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_autorizacoes_convenio (
    nr_sequencia bigint NOT NULL,
    nr_atendimento bigint,
    nr_seq_autorizacao bigint,
    ds_tipo_atendimento character varying(80),
    cd_convenio integer,
    ds_convenio character varying(150),
    cd_autorizacao character varying(100),
    cd_senha character varying(100),
    dt_pedido_medico timestamp without time zone,
    dt_envio timestamp without time zone,
    dt_retorno timestamp without time zone,
    dt_autorizacao timestamp without time zone,
    dt_inicio_vigencia timestamp without time zone,
    dt_fim_vigencia timestamp without time zone,
    dt_atualizacao timestamp without time zone,
    dt_entrada_prevista timestamp without time zone,
    ie_tipo_guia character(2),
    ds_tipo_guia character varying(50),
    nr_seq_estagio integer,
    ds_estagio character varying(80),
    ie_tipo_autorizacao character varying(10),
    ds_tipo_autorizacao character varying(80),
    nr_seq_classif integer,
    ds_classificacao character varying(80),
    ie_carater character(2),
    ds_carater character varying(50),
    ie_tipo_internacao character varying(10),
    ds_tipo_internacao character varying(80),
    cd_tipo_acomodacao integer,
    cd_pessoa_fisica character varying(20),
    nm_paciente character varying(120),
    cd_medico_solicitante character varying(20),
    nm_medico_solicitante character varying(120),
    cd_setor_origem integer,
    ds_setor_origem character varying(80),
    cd_setor_resp integer,
    ds_setor_resp character varying(80),
    ds_setor_atendimento character varying(80),
    ds_unidade character varying(40),
    ds_observacao character varying(1000),
    ds_indicacao character varying(1000),
    ds_motivo_cancelamento character varying(500),
    nm_usuario character varying(60),
    nm_usuario_nrec character varying(60),
    nm_usuario_resp character varying(60),
    cd_estabelecimento integer,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_contas_paciente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_contas_paciente (
    nr_interno_conta bigint NOT NULL,
    nr_atendimento bigint NOT NULL,
    dt_periodo_inicial timestamp without time zone,
    dt_periodo_final timestamp without time zone,
    dt_mesano_referencia timestamp without time zone,
    cd_estabelecimento integer,
    cd_convenio_parametro integer,
    ds_convenio character varying(150),
    cd_categoria character varying(20),
    vl_conta numeric(15,2),
    vl_desconto numeric(15,2),
    vl_base_conta numeric(15,2),
    vl_conta_relat numeric(15,2),
    ie_cancelamento character(1),
    dt_cancelamento timestamp without time zone,
    ie_status_acerto character varying(10),
    dt_acerto_conta timestamp without time zone,
    nr_seq_protocolo bigint,
    nr_conta_convenio character varying(50),
    ie_tipo_guia character(2),
    cd_autorizacao character varying(100),
    nr_seq_estagio_conta integer,
    dt_conta_definitiva timestamp without time zone,
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_convenio_sla; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_convenio_sla (
    cd_convenio integer NOT NULL,
    ds_convenio character varying(150),
    qt_dias_prazo integer DEFAULT 7 NOT NULL,
    ie_ativo character(1) DEFAULT 'S'::bpchar NOT NULL,
    ds_observacao character varying(500),
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_materiais_conta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_materiais_conta (
    nr_sequencia bigint NOT NULL,
    nr_atendimento bigint,
    nr_interno_conta bigint,
    cd_material character varying(30),
    ds_material character varying(150),
    cd_material_tuss character varying(30),
    cd_unidade_medida character varying(30),
    qt_material numeric(15,4),
    qt_devolvida numeric(15,4),
    vl_unitario numeric(15,4),
    vl_material numeric(15,4),
    vl_tabela_original numeric(15,4),
    dt_atendimento timestamp without time zone,
    dt_conta timestamp without time zone,
    dt_prescricao timestamp without time zone,
    dt_acerto_conta timestamp without time zone,
    dt_acerto_convenio timestamp without time zone,
    cd_convenio integer,
    cd_setor_atendimento integer,
    nr_seq_autorizacao bigint,
    nr_seq_mat_autor bigint,
    cd_motivo_exc_conta integer,
    ie_valor_informado character(1),
    ie_glosado character(1),
    ie_tipo_guia character(2),
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_procedimentos_conta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_procedimentos_conta (
    nr_sequencia bigint NOT NULL,
    nr_atendimento bigint,
    nr_interno_conta bigint,
    cd_procedimento bigint,
    ie_origem_proced integer,
    cd_procedimento_tuss bigint,
    ds_procedimento character varying(200),
    qt_procedimento numeric(15,4),
    vl_procedimento numeric(15,4),
    vl_medico numeric(15,4),
    vl_anestesista numeric(15,4),
    vl_materiais numeric(15,4),
    vl_custo_operacional numeric(15,4),
    vl_original_tabela numeric(15,4),
    vl_total_proc numeric(15,4),
    dt_procedimento timestamp without time zone,
    dt_conta timestamp without time zone,
    dt_prescricao timestamp without time zone,
    dt_acerto_conta timestamp without time zone,
    dt_acerto_convenio timestamp without time zone,
    cd_convenio integer,
    cd_setor_atendimento integer,
    nr_seq_autorizacao bigint,
    nr_seq_proc_autor bigint,
    cd_motivo_exc_conta integer,
    ie_valor_informado character(1),
    ie_tipo_guia character(2),
    dt_atualizacao timestamp without time zone,
    nm_usuario character varying(60),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel33_responsaveis_convenio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel33_responsaveis_convenio (
    id integer NOT NULL,
    nm_responsavel character varying(200) NOT NULL,
    ds_convenio character varying(200) NOT NULL,
    ativo boolean DEFAULT true,
    dt_criacao timestamp without time zone DEFAULT now()
);


--
-- Name: painel33_responsaveis_convenio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel33_responsaveis_convenio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel33_responsaveis_convenio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel33_responsaveis_convenio_id_seq OWNED BY public.painel33_responsaveis_convenio.id;


--
-- Name: painel39_interacoes_dieta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel39_interacoes_dieta (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    nm_pessoa_fisica character varying(200),
    dt_nascimento date,
    cd_setor_atendimento integer,
    ds_setor character varying(200),
    cd_unidade character varying(20),
    dt_entrada_unidade timestamp without time zone,
    nr_prescricao bigint NOT NULL,
    dt_prescricao timestamp without time zone,
    cd_material bigint NOT NULL,
    ds_material character varying(255),
    cd_dieta bigint NOT NULL,
    dieta character varying(255),
    nm_usuario_dieta character varying(100),
    ds_interacao text,
    dt_atualizacao timestamp without time zone,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel39_interacoes_dieta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel39_interacoes_dieta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel39_interacoes_dieta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel39_interacoes_dieta_id_seq OWNED BY public.painel39_interacoes_dieta.id;


--
-- Name: painel40_requisicoes_urgentes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel40_requisicoes_urgentes (
    id integer NOT NULL,
    nr_requisicao bigint NOT NULL,
    cd_local_estoque integer,
    ds_local_estoque character varying(200),
    dt_solicitacao_requisicao timestamp without time zone,
    cd_pessoa_requisitante character varying(20),
    nm_requisitante character varying(200),
    cd_operacao_estoque integer,
    ds_operacao_estoque character varying(200),
    cd_local_estoque_destino integer,
    ds_local_estoque_destino character varying(200),
    dt_liberacao timestamp without time zone,
    cd_material bigint,
    ds_material character varying(255),
    qt_material_requisitada numeric(15,4),
    cd_unidade_medida character varying(30),
    dt_atendimento timestamp without time zone,
    cd_pessoa_atende character varying(20),
    nm_pessoa_atende character varying(200),
    nr_seq_lote_fornec bigint,
    cd_barras character varying(50),
    ds_motivo_baixa character varying(200),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel40_requisicoes_urgentes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel40_requisicoes_urgentes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel40_requisicoes_urgentes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel40_requisicoes_urgentes_id_seq OWNED BY public.painel40_requisicoes_urgentes.id;


--
-- Name: painel_cirurgias_hemodinamica; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_cirurgias_hemodinamica (
    id integer NOT NULL,
    dt_referencia date,
    dt_inicio_prevista timestamp without time zone,
    dt_inicio_real timestamp without time zone,
    dt_termino timestamp without time zone,
    dt_liberacao timestamp without time zone,
    nr_atendimento character varying(50),
    nr_cirurgia character varying(50),
    status_cirurgia character varying(100),
    setor character varying(50) NOT NULL,
    tempo_cirurgia_min numeric,
    paciente character varying(255),
    sexo character varying(20),
    idade numeric,
    ie_faixa_etaria character varying(20),
    municipio character varying(255),
    ds_convenio character varying(255),
    cirurgiao character varying(255),
    especialidade character varying(255),
    anestesista character varying(255),
    cd_tipo_anestesia character varying(50),
    cd_procedimento character varying(50),
    procedimento character varying(500),
    ds_tipo_cirurgia character varying(255),
    ie_porte_preco character varying(50),
    ie_porte_anestesico character varying(50),
    carater character varying(100),
    clinica character varying(255),
    data_entrada timestamp without time zone,
    data_alta timestamp without time zone,
    ds_tipo_acomodacao character varying(255),
    cid_preliminar text,
    cid_definitivo text,
    dia_semana character varying(20),
    ds_motivo_cancelamento text,
    ds_observacao text,
    cd_tipo_cirurgia character varying(50),
    opme character varying(10),
    classificacao_asa character varying(255),
    mes_referencia date NOT NULL,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel_cirurgias_hemodinamica_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_cirurgias_hemodinamica_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_cirurgias_hemodinamica_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_cirurgias_hemodinamica_id_seq OWNED BY public.painel_cirurgias_hemodinamica.id;


--
-- Name: painel_clinico_analise_ia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_clinico_analise_ia (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    dt_analise timestamp without time zone DEFAULT now(),
    nm_paciente character varying(200),
    cd_leito character varying(20),
    nm_setor character varying(100),
    analise_ia text,
    pontos_atencao text,
    recomendacoes text,
    nivel_criticidade character varying(20),
    score_ia numeric(5,2),
    modelo_ia character varying(50) DEFAULT 'llama-3.3-70b'::character varying,
    versao_prompt character varying(20) DEFAULT 'v1.0'::character varying,
    tempo_processamento_ms integer,
    dt_atualizacao timestamp without time zone DEFAULT now(),
    hash_dados character varying(64),
    ie_ativo boolean DEFAULT true,
    dt_expiracao timestamp without time zone
);


--
-- Name: painel_clinico_analise_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_clinico_analise_ia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_clinico_analise_ia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_clinico_analise_ia_id_seq OWNED BY public.painel_clinico_analise_ia.id;


--
-- Name: painel_clinico_tasy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_clinico_tasy (
    nr_atendimento bigint NOT NULL,
    dt_entrada_unidade date,
    dt_entrada_unid text,
    cd_unidade character varying(20),
    cd_unidade_basica character varying(20),
    nm_pessoa_fisica character varying(200),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    dt_nascimento date,
    ie_sexo character(1),
    ds_convenio character varying(100),
    nr_crm character varying(20),
    nm_guerra character varying(150),
    qt_dia_permanencia integer,
    ds_clinica character varying(100),
    dt_alta_medico date,
    ds_tipo_acomodacao character varying(50),
    classif character varying(50),
    ie_status_unidade character varying(20),
    qt_pa_sistolica numeric(10,2),
    qt_pa_diastolica numeric(10,2),
    qt_pam numeric(10,2),
    qt_freq_cardiaca numeric(10,2),
    qt_freq_resp numeric(10,2),
    qt_temp numeric(10,2),
    qt_saturacao_o2 numeric(10,2),
    qt_peso numeric(10,2),
    qt_imc numeric(10,2),
    qt_glicemia_capilar numeric(10,2),
    qt_escala_dor numeric(10,2),
    exm_glicose text,
    exm_creatinina text,
    exm_ureia text,
    exm_sodio text,
    exm_potassio text,
    exm_calcio_ionico text,
    exm_fosforo text,
    exm_magnesio text,
    exm_hematocrito text,
    exm_hemoglobina text,
    exm_leucocitos text,
    exm_plaquetas text,
    exm_bilir_total text,
    exm_bilir_indireta text,
    exm_bilir_direta text,
    exm_ggt text,
    exm_rni text,
    exm_troponina text,
    exm_dimero_d text,
    exm_lactato_art text,
    exm_lactato_ven text,
    exm_ca_art text,
    exm_ca_ven text,
    exm_ph_art text,
    exm_pco2_art text,
    exm_po2_art text,
    exm_so2_art text,
    exm_hco3_art text,
    exm_be_art text,
    exm_pao2_art text,
    exm_fio2_art text,
    exm_ph_ven text,
    exm_pco2_ven text,
    exm_po2_ven text,
    exm_so2_ven text,
    exm_hco3_ven text,
    exm_be_ven text,
    exm_ag_ven text,
    exm_pao2_ven text,
    dt_carga timestamp without time zone DEFAULT now()
);


--
-- Name: painel_enfermaria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_enfermaria (
    nr_atendimento bigint,
    cd_unidade character varying(20) NOT NULL,
    cd_unidade_basica character varying(20),
    cd_setor_atendimento integer NOT NULL,
    nm_setor character varying(100) NOT NULL,
    nm_pessoa_fisica character varying(200),
    nr_anos integer,
    dt_nascimento character varying(30),
    ie_sexo character(1),
    ds_convenio character varying(100),
    dt_entrada_unidade character varying(30),
    dt_entrada_unid character varying(30),
    qt_dia_permanencia integer DEFAULT 0,
    ds_clinica character varying(100),
    dt_alta_medico character varying(30),
    ds_tipo_acomodacao character varying(50),
    classif character varying(50),
    ie_status_unidade character(1),
    nr_crm character varying(20),
    nm_guerra character varying(100),
    nr_prescricao bigint,
    medico character varying(200),
    dt_inicio_prescr character varying(30),
    dt_validade_prescr character varying(30),
    dt_liberacao_medico character varying(30),
    prescrito_lab_dia character varying(3) DEFAULT 'Não'::character varying,
    prescrito_proc_dia character varying(3) DEFAULT 'Não'::character varying,
    evol_medico character varying(5) DEFAULT 'X'::character varying,
    evol_enfermeiro character varying(5) DEFAULT 'X'::character varying,
    evol_tec_enfermagem character varying(5) DEFAULT 'X'::character varying,
    evol_nutricionista character varying(5) DEFAULT 'X'::character varying,
    evol_fisioterapeuta character varying(5) DEFAULT 'X'::character varying,
    parecer_pendente character varying(3) DEFAULT 'Não'::character varying,
    alergia character varying(3) DEFAULT 'Não'::character varying,
    score_news integer DEFAULT 0,
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dt_previsto_alta character varying(30),
    especialidade character varying(100)
);


--
-- Name: painel_plano_terapeutico_enfermagem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_plano_terapeutico_enfermagem (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    nm_pessoa_fisica text NOT NULL,
    dt_nascimento date,
    ie_sexo character(1),
    ds_convenio text,
    cd_setor_atendimento integer CONSTRAINT painel_plano_terapeutico_enfermag_cd_setor_atendimento_not_null NOT NULL,
    ds_setor text NOT NULL,
    cd_unidade character varying(20),
    cd_unidade_basica character varying(20),
    dt_entrada_unidade date,
    dt_entrada_unid character varying(30),
    qt_dia_permanencia integer,
    ds_clinica text,
    nr_crm character varying(20),
    nm_medico text,
    ds_tipo_acomodacao text,
    classif text,
    ie_status_unidade character varying(5),
    ie_temporario character(1),
    dt_alta_medico timestamp without time zone,
    nr_seq_avaliacao bigint,
    dt_avaliacao date,
    dt_liberacao date,
    nm_usuario_aval character varying(50),
    cd_profissional character varying(20),
    cd_meta character varying(20),
    ds_meta text,
    ds_prazo_str character varying(20),
    dt_prazo date,
    ie_status_prazo character varying(20) NOT NULL,
    dt_carga timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_p31_status_prazo CHECK (((ie_status_prazo)::text = ANY (ARRAY[('SEM_AVALIACAO'::character varying)::text, ('SEM_PRAZO'::character varying)::text, ('VENCIDO'::character varying)::text, ('PROXIMO'::character varying)::text, ('NO_PRAZO'::character varying)::text])))
);


--
-- Name: painel_plano_terapeutico_enfermagem_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_plano_terapeutico_enfermagem_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_plano_terapeutico_enfermagem_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_plano_terapeutico_enfermagem_id_seq OWNED BY public.painel_plano_terapeutico_enfermagem.id;


--
-- Name: painel_prescricoes_nutricao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_prescricoes_nutricao (
    id integer NOT NULL,
    nr_atendimento character varying(20) NOT NULL,
    nm_paciente character varying(255),
    leito character varying(50),
    dt_entrada timestamp without time zone,
    setor character varying(255),
    nm_medico character varying(255),
    convenio character varying(255),
    idade character varying(50),
    dt_prescricao timestamp without time zone,
    prescritor character varying(255),
    nm_prescritor character varying(255),
    dieta text,
    ds_observacao text,
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    nr_prescricao bigint,
    alergia character varying(10),
    acompanhante character varying(10)
);


--
-- Name: painel_prescricoes_nutricao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_prescricoes_nutricao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_prescricoes_nutricao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_prescricoes_nutricao_id_seq OWNED BY public.painel_prescricoes_nutricao.id;


--
-- Name: painel_producao_mensal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_producao_mensal (
    id integer NOT NULL,
    dt_conta date NOT NULL,
    nr_atendimento bigint,
    nr_interno_conta bigint,
    vl_produzido numeric(15,2),
    vl_custo_medio numeric(15,2),
    setor_paciente character varying(255),
    ds_convenio character varying(255),
    grupo_receita character varying(255),
    ds_item character varying(500),
    quantidade numeric(15,2),
    paciente character varying(255),
    tipo_atendimento character varying(100),
    ds_carater_inter_sus character varying(255),
    ds_clinica character varying(255),
    email character varying(255),
    codigo character varying(100),
    tipo character varying(100),
    status_vl_conta character varying(100),
    status_conta_case character varying(100),
    mes_referencia date NOT NULL,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel_producao_mensal_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_producao_mensal_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_producao_mensal_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_producao_mensal_id_seq OWNED BY public.painel_producao_mensal.id;


--
-- Name: painel_ps_alta_internacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_ps_alta_internacao (
    cd_pessoa_fisica character varying(20),
    nr_atendimento character varying(20),
    nr_atendimento_internado character varying(20),
    nm_pessoa_fisica character varying(255),
    dt_nascimento character varying(50),
    ds_idade character varying(50),
    qt_idade character varying(10),
    dt_entrada character varying(50),
    hr_inicio_consulta character varying(20),
    dt_inicio_atendimento character varying(50),
    hr_fim_consulta character varying(20),
    hr_reavaliacao_medica character varying(20),
    dt_fim_reavaliacao character varying(50),
    dt_atend_medico character varying(50),
    dt_fim_triagem character varying(50),
    dt_alta character varying(50),
    dt_lib_medico character varying(50),
    dt_medicacao character varying(50),
    hr_espera character varying(20),
    cd_medico_resp character varying(20),
    nm_guerra character varying(255),
    ds_clinica character varying(255),
    ds_convenio character varying(255),
    ds_plano character varying(255),
    ie_desfecho character(1),
    cd_motivo_alta character varying(10),
    ds_senha_qmatic character varying(50),
    ds_senha_gerenciamento character varying(50),
    ie_status_pa character varying(100),
    ds_fila character varying(255),
    ds_necessidade_vaga character varying(255),
    qt_tempo_local_pa character varying(255),
    atendimento_internado character varying(20),
    dt_internacao character varying(50),
    status_internacao character varying(50),
    tempo_aguardando_vaga character varying(100),
    dt_carga character varying(50),
    cd_status_gv character varying(10),
    ds_status_gv character varying(255)
);


--
-- Name: painel_ps_analise; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_ps_analise (
    nr_atendimento bigint NOT NULL,
    nm_pessoa_fisica character varying(255),
    dt_nascimento character varying(50),
    qt_idade character varying(10),
    ds_idade character varying(50),
    ds_convenio character varying(255),
    ds_plano character varying(255),
    cd_medico_resp character varying(20),
    nm_guerra character varying(255),
    ds_clinica character varying(255),
    dt_entrada character varying(50) NOT NULL,
    dt_inicio_atendimento character varying(50),
    hr_inicio_consulta character varying(50),
    hr_fim_consulta character varying(50),
    dt_atend_medico character varying(50),
    dt_fim_triagem character varying(50),
    hr_reavaliacao_medica character varying(50),
    dt_fim_reavaliacao character varying(50),
    dt_alta character varying(50),
    dt_lib_medico character varying(50),
    dt_medicacao character varying(50),
    ds_senha_qmatic character varying(50),
    ds_senha_gerenciamento character varying(50),
    ds_fila character varying(100),
    hr_espera character varying(50),
    ie_status_pa character varying(100),
    qt_tempo_local_pa character varying(255),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel_ps_atendimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_ps_atendimentos (
    id integer NOT NULL,
    nr_atendimento character varying(50) NOT NULL,
    cd_pessoa_fisica character varying(50),
    nm_pessoa_fisica character varying(255),
    dt_nascimento timestamp without time zone,
    ds_idade character varying(50),
    qt_idade character varying(50),
    dt_entrada timestamp without time zone,
    hr_inicio_consulta character varying(50),
    dt_inicio_atendimento timestamp without time zone,
    hr_fim_consulta character varying(50),
    hr_reavaliacao_medica character varying(50),
    dt_fim_reavaliacao timestamp without time zone,
    dt_atend_medico timestamp without time zone,
    dt_fim_triagem timestamp without time zone,
    dt_alta timestamp without time zone,
    dt_lib_medico timestamp without time zone,
    dt_medicacao timestamp without time zone,
    hr_espera character varying(50),
    cd_medico_resp character varying(50),
    nm_guerra character varying(255),
    ds_clinica character varying(255),
    ds_convenio character varying(255),
    ds_plano character varying(255),
    ie_desfecho character varying(10),
    cd_motivo_alta character varying(50),
    ds_senha_qmatic character varying(50),
    ds_senha_gerenciamento character varying(50),
    ie_status_pa character varying(100),
    ds_fila character varying(255),
    ds_necessidade_vaga character varying(500),
    qt_tempo_local_pa character varying(255),
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    mes_referencia date GENERATED ALWAYS AS ((date_trunc('MONTH'::text, dt_entrada))::date) STORED
);


--
-- Name: painel_ps_atendimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_ps_atendimentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_ps_atendimentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_ps_atendimentos_id_seq OWNED BY public.painel_ps_atendimentos.id;


--
-- Name: painel_ps_conversao_internacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_ps_conversao_internacao (
    id integer NOT NULL,
    nr_atendimento_ps character varying(50) NOT NULL,
    nr_atendimento_internado character varying(50),
    dt_alta_ps timestamp without time zone,
    dt_internacao timestamp without time zone,
    tempo_ate_internacao_min numeric,
    mes_referencia date NOT NULL,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: painel_ps_conversao_internacao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_ps_conversao_internacao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_ps_conversao_internacao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_ps_conversao_internacao_id_seq OWNED BY public.painel_ps_conversao_internacao.id;


--
-- Name: painel_score_farmaceutico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_score_farmaceutico (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    nm_paciente text NOT NULL,
    dt_nascimento date,
    ie_sexo character(1),
    ds_convenio text,
    cd_setor_atendimento integer NOT NULL,
    ds_setor_atendimento text NOT NULL,
    cd_unidade_basica character varying(20),
    dt_entrada_unidade date,
    qt_dia_permanencia integer,
    ds_clinica text,
    ds_tipo_acomodacao text,
    nm_medico text,
    nr_crm character varying(20),
    pt_total integer NOT NULL,
    qt_criterios integer NOT NULL,
    ie_classificacao character varying(10) NOT NULL,
    ds_criterios text,
    dt_ultima_visita timestamp without time zone,
    nm_farmaceutico character varying(100),
    qt_visitas_30d integer,
    qt_dias_sem_visita integer,
    ie_status_visita character varying(15) NOT NULL,
    dt_carga timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_p38_classificacao CHECK (((ie_classificacao)::text = ANY (ARRAY[('LEVE'::character varying)::text, ('MEDIO'::character varying)::text, ('CRITICO'::character varying)::text]))),
    CONSTRAINT chk_p38_status_visita CHECK (((ie_status_visita)::text = ANY (ARRAY[('RECENTE'::character varying)::text, ('ATENCAO'::character varying)::text, ('ATRASADA'::character varying)::text, ('SEM_VISITA'::character varying)::text])))
);


--
-- Name: painel_score_farmaceutico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_score_farmaceutico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_score_farmaceutico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_score_farmaceutico_id_seq OWNED BY public.painel_score_farmaceutico.id;


--
-- Name: painel_sepse_analise_ia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.painel_sepse_analise_ia (
    id integer NOT NULL,
    nr_atendimento bigint NOT NULL,
    criterio_hipotensao boolean DEFAULT false,
    criterio_dessaturacao boolean DEFAULT false,
    criterio_temperatura boolean DEFAULT false,
    criterio_leucocitos boolean DEFAULT false,
    criterio_taquicardia boolean DEFAULT false,
    criterio_taquipneia boolean DEFAULT false,
    criterio_plaquetopenia boolean DEFAULT false,
    criterio_disfuncao_renal boolean DEFAULT false,
    criterio_hiperlactatemia boolean DEFAULT false,
    criterio_qsofa_fr boolean DEFAULT false,
    criterio_qsofa_pas boolean DEFAULT false,
    pressao_sistolica numeric(5,2),
    pressao_diastolica numeric(5,2),
    frequencia_cardiaca integer,
    frequencia_respiratoria integer,
    temperatura numeric(4,2),
    saturacao_o2 numeric(5,2),
    leucocitos numeric(10,2),
    plaquetas numeric(10,2),
    creatinina numeric(5,2),
    lactato numeric(5,2),
    total_criterios_principais integer,
    total_criterios_adicionais integer,
    qsofa_score integer,
    nivel_risco character varying(20),
    analise_ia text,
    recomendacoes_ia text,
    interpretacao_criterios text,
    resumo_clinico text,
    modelo_ia character varying(100),
    data_analise timestamp without time zone DEFAULT now(),
    tempo_processamento_ms integer,
    ie_ativo boolean DEFAULT true,
    dt_inativacao timestamp without time zone,
    dt_criacao timestamp without time zone DEFAULT now(),
    dt_atualizacao timestamp without time zone DEFAULT now()
);


--
-- Name: painel_sepse_analise_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.painel_sepse_analise_ia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: painel_sepse_analise_ia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.painel_sepse_analise_ia_id_seq OWNED BY public.painel_sepse_analise_ia.id;


--
-- Name: pareceres_pendentes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pareceres_pendentes (
    nr_parecer bigint NOT NULL,
    nr_atendimento bigint,
    cd_paciente character varying(20),
    nm_paciente character varying(200),
    cd_medico character varying(20),
    nm_medico_solicitante character varying(200),
    cd_especialidade_dest integer,
    especialidade_destino character varying(100),
    dt_solicitacao character varying(30),
    horas_pendente numeric(10,1),
    ie_tipo_atendimento character varying(5),
    ds_tipo_atendimento character varying(100),
    ds_convenio character varying(100),
    dt_entrada_hospital character varying(30),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    cd_leito character varying(20),
    ie_situacao character varying(5),
    cd_medico_parecerista character varying(20),
    nm_medico_parecerista character varying(200),
    status_parecer character varying(5),
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ds_motivo_consulta text
);


--
-- Name: pendencias_lab; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pendencias_lab (
    nr_atendimento bigint NOT NULL,
    dt_entrada_unidade date,
    dt_entrada_unid timestamp without time zone,
    cd_unidade character varying(20),
    cd_unidade_basica character varying(20),
    nm_pessoa_fisica character varying(255),
    dt_nascimento date,
    ie_sexo character(1),
    cd_setor_atendimento integer,
    nm_setor character varying(100),
    ds_convenio character varying(100),
    nr_crm character varying(20),
    nm_guerra character varying(255),
    qt_dia_permanencia integer,
    ds_clinica character varying(100),
    dt_alta_medico timestamp without time zone,
    ds_tipo_acomodacao character varying(50),
    classif character varying(50),
    ie_status_unidade character(1),
    lab_pendentes text,
    img_pendentes text,
    dt_carga timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dt_atualizacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: permissoes_paineis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.permissoes_paineis (
    id integer NOT NULL,
    usuario_id integer,
    painel_nome character varying(50) NOT NULL,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: permissoes_paineis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.permissoes_paineis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissoes_paineis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissoes_paineis_id_seq OWNED BY public.permissoes_paineis.id;


--
-- Name: sentir_agir_analises_categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_analises_categorias (
    id integer NOT NULL,
    data_referencia date NOT NULL,
    periodo_dias integer DEFAULT 7 NOT NULL,
    analise_texto text NOT NULL,
    categorias_json jsonb,
    total_tratativas integer DEFAULT 0,
    total_categorias integer DEFAULT 0,
    modelo character varying(100),
    gerado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    gerado_por character varying(50) DEFAULT 'worker'::character varying
);


--
-- Name: sentir_agir_analises_categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_analises_categorias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_analises_categorias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_analises_categorias_id_seq OWNED BY public.sentir_agir_analises_categorias.id;


--
-- Name: sentir_agir_analises_ia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_analises_ia (
    id integer NOT NULL,
    data_analise date NOT NULL,
    analise_texto text NOT NULL,
    total_visitas integer DEFAULT 0,
    total_criticos integer DEFAULT 0,
    total_atencao integer DEFAULT 0,
    total_setores integer DEFAULT 0,
    modelo character varying(100),
    gerado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    gerado_por character varying(50) DEFAULT 'worker'::character varying
);


--
-- Name: sentir_agir_analises_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_analises_ia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_analises_ia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_analises_ia_id_seq OWNED BY public.sentir_agir_analises_ia.id;


--
-- Name: sentir_agir_avaliacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_avaliacoes (
    id integer NOT NULL,
    visita_id integer NOT NULL,
    item_id integer NOT NULL,
    resultado character varying(20) NOT NULL,
    criado_em timestamp without time zone DEFAULT now(),
    CONSTRAINT sentir_agir_avaliacoes_resultado_check CHECK (((resultado)::text = ANY (ARRAY[('critico'::character varying)::text, ('atencao'::character varying)::text, ('adequado'::character varying)::text, ('nao_aplica'::character varying)::text, ('sim'::character varying)::text, ('nao'::character varying)::text])))
);


--
-- Name: sentir_agir_avaliacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_avaliacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_avaliacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_avaliacoes_id_seq OWNED BY public.sentir_agir_avaliacoes.id;


--
-- Name: sentir_agir_categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_categorias (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    icone character varying(80),
    cor character varying(30),
    ordem integer DEFAULT 0,
    permite_nao_aplica boolean DEFAULT false,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_categorias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_categorias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_categorias_id_seq OWNED BY public.sentir_agir_categorias.id;


--
-- Name: sentir_agir_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_config (
    id integer NOT NULL,
    chave character varying(100) NOT NULL,
    valor text,
    descricao character varying(500),
    atualizado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_config_id_seq OWNED BY public.sentir_agir_config.id;


--
-- Name: sentir_agir_duplas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_duplas (
    id integer NOT NULL,
    nome_visitante_1 character varying(150) NOT NULL,
    nome_visitante_2 character varying(150) NOT NULL,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_duplas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_duplas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_duplas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_duplas_id_seq OWNED BY public.sentir_agir_duplas.id;


--
-- Name: sentir_agir_imagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_imagens (
    id integer NOT NULL,
    visita_id integer NOT NULL,
    caminho_arquivo character varying(1000) NOT NULL,
    nome_original character varying(500),
    descricao character varying(1000),
    tamanho_bytes bigint,
    tipo_mime character varying(100),
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_imagens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_imagens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_imagens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_imagens_id_seq OWNED BY public.sentir_agir_imagens.id;


--
-- Name: sentir_agir_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_itens (
    id integer NOT NULL,
    categoria_id integer NOT NULL,
    descricao character varying(500) NOT NULL,
    ordem integer DEFAULT 0,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now(),
    tipo character varying(20) DEFAULT 'semaforo'::character varying,
    critico_quando character varying(3) DEFAULT 'nao'::character varying NOT NULL,
    permite_nao_aplica boolean DEFAULT false,
    tipo_resposta character varying(10) DEFAULT 'semaforo'::character varying,
    gera_critico boolean DEFAULT true,
    CONSTRAINT sentir_agir_itens_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('semaforo'::character varying)::text, ('sim_nao'::character varying)::text])))
);


--
-- Name: sentir_agir_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_itens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_itens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_itens_id_seq OWNED BY public.sentir_agir_itens.id;


--
-- Name: sentir_agir_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_log (
    id integer NOT NULL,
    entidade character varying(50) NOT NULL,
    entidade_id integer,
    acao character varying(50) NOT NULL,
    campo_alterado character varying(100),
    valor_anterior text,
    valor_novo text,
    usuario character varying(150),
    ip_origem character varying(45),
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_log_id_seq OWNED BY public.sentir_agir_log.id;


--
-- Name: sentir_agir_precaucao_contato; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_precaucao_contato (
    nr_atendimento character varying(50) NOT NULL,
    nm_paciente character varying(200),
    leito character varying(50),
    marcado_por character varying(100) NOT NULL,
    marcado_em timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sentir_agir_responsaveis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_responsaveis (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    email character varying(200),
    telefone character varying(50),
    cargo character varying(150),
    categoria_id integer,
    setor_id integer,
    observacoes text,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_responsaveis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_responsaveis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_responsaveis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_responsaveis_id_seq OWNED BY public.sentir_agir_responsaveis.id;


--
-- Name: sentir_agir_responsavel_categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_responsavel_categorias (
    id integer NOT NULL,
    responsavel_id integer NOT NULL,
    categoria_id integer NOT NULL
);


--
-- Name: sentir_agir_responsavel_categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_responsavel_categorias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_responsavel_categorias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_responsavel_categorias_id_seq OWNED BY public.sentir_agir_responsavel_categorias.id;


--
-- Name: sentir_agir_responsavel_setores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_responsavel_setores (
    id integer NOT NULL,
    responsavel_id integer NOT NULL,
    setor_id integer NOT NULL
);


--
-- Name: sentir_agir_responsavel_setores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_responsavel_setores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_responsavel_setores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_responsavel_setores_id_seq OWNED BY public.sentir_agir_responsavel_setores.id;


--
-- Name: sentir_agir_rondas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_rondas (
    id integer NOT NULL,
    data_ronda date NOT NULL,
    dupla_id integer NOT NULL,
    criado_por character varying(150),
    status character varying(30) DEFAULT 'em_andamento'::character varying,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now(),
    CONSTRAINT sentir_agir_rondas_status_check CHECK (((status)::text = ANY (ARRAY[('em_andamento'::character varying)::text, ('concluida'::character varying)::text, ('cancelada'::character varying)::text])))
);


--
-- Name: sentir_agir_rondas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_rondas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_rondas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_rondas_id_seq OWNED BY public.sentir_agir_rondas.id;


--
-- Name: sentir_agir_setor_mapeamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_setor_mapeamento (
    id integer NOT NULL,
    cd_setor_ocupacao integer NOT NULL,
    nome_setor_ocupacao character varying(200),
    setor_sa_id integer NOT NULL,
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_setor_mapeamento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_setor_mapeamento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_setor_mapeamento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_setor_mapeamento_id_seq OWNED BY public.sentir_agir_setor_mapeamento.id;


--
-- Name: sentir_agir_setores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_setores (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    sigla character varying(20),
    icone character varying(80),
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 0,
    criado_em timestamp without time zone DEFAULT now()
);


--
-- Name: sentir_agir_setores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_setores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_setores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_setores_id_seq OWNED BY public.sentir_agir_setores.id;


--
-- Name: sentir_agir_tratativas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_tratativas (
    id integer NOT NULL,
    visita_id integer NOT NULL,
    avaliacao_id integer NOT NULL,
    item_id integer NOT NULL,
    categoria_id integer NOT NULL,
    responsavel_id integer,
    responsavel_nome_manual character varying(200),
    descricao_problema text NOT NULL,
    plano_acao text,
    observacoes_resolucao text,
    status character varying(20) DEFAULT 'pendente'::character varying,
    prioridade character varying(20) DEFAULT 'normal'::character varying,
    data_inicio_tratativa timestamp without time zone,
    data_resolucao timestamp without time zone,
    resolvido_por character varying(150),
    notificado_em timestamp without time zone,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now(),
    CONSTRAINT sentir_agir_tratativas_prioridade_check CHECK (((prioridade)::text = ANY (ARRAY[('baixa'::character varying)::text, ('normal'::character varying)::text, ('alta'::character varying)::text, ('urgente'::character varying)::text]))),
    CONSTRAINT sentir_agir_tratativas_status_check CHECK (((status)::text = ANY (ARRAY[('pendente'::character varying)::text, ('em_tratativa'::character varying)::text, ('regularizado'::character varying)::text, ('cancelado'::character varying)::text])))
);


--
-- Name: sentir_agir_tratativas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_tratativas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_tratativas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_tratativas_id_seq OWNED BY public.sentir_agir_tratativas.id;


--
-- Name: sentir_agir_visitas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.sentir_agir_visitas (
    id integer NOT NULL,
    ronda_id integer NOT NULL,
    setor_id integer NOT NULL,
    leito character varying(30) NOT NULL,
    nr_atendimento character varying(30),
    observacoes text,
    avaliacao_final character varying(20) NOT NULL,
    criado_em timestamp without time zone DEFAULT now(),
    atualizado_em timestamp without time zone DEFAULT now(),
    nm_paciente character varying(200),
    setor_ocupacao character varying(200),
    qt_dias_internacao numeric,
    status_tratativa character varying(20) DEFAULT 'sem_pendencia'::character varying,
    CONSTRAINT sentir_agir_visitas_avaliacao_final_check CHECK (((avaliacao_final)::text = ANY ((ARRAY['critico'::character varying, 'atencao'::character varying, 'adequado'::character varying, 'impossibilitada'::character varying, 'precaucao_contato'::character varying])::text[]))),
    CONSTRAINT sentir_agir_visitas_status_tratativa_check CHECK (((status_tratativa)::text = ANY (ARRAY[('sem_pendencia'::character varying)::text, ('pendente'::character varying)::text, ('em_tratativa'::character varying)::text, ('regularizado'::character varying)::text])))
);


--
-- Name: sentir_agir_visitas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.sentir_agir_visitas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentir_agir_visitas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentir_agir_visitas_id_seq OWNED BY public.sentir_agir_visitas.id;


--
-- Name: setores_hospital; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.setores_hospital (
    cd_setor integer NOT NULL,
    nm_setor character varying(200) NOT NULL,
    qt_leitos_total integer DEFAULT 0,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usuarios (
    id integer NOT NULL,
    usuario character varying(50) NOT NULL,
    senha_hash character varying(255) NOT NULL,
    email character varying(100) NOT NULL,
    is_admin boolean DEFAULT false,
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ultimo_acesso timestamp without time zone,
    atualizado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    nome_completo character varying(200),
    cargo character varying(100),
    ativo boolean DEFAULT true,
    observacoes text,
    force_reset_senha boolean DEFAULT false,
    reset_pin_hash character varying(255),
    reset_pin_expira timestamp without time zone,
    atualizado_por integer
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: vw_chamados_ativos; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_chamados_ativos AS
 SELECT id,
    numero_kora,
    nome_solicitante,
    local_problema,
    setor,
    hostname,
    ip,
    problema_descricao,
    observacao_abertura,
    data_abertura,
    data_visualizacao,
    tecnico_atendimento,
    data_inicio_atendimento,
    status,
    prioridade,
    visualizado,
    local_id,
    problema_id,
    (EXTRACT(epoch FROM (now() - (data_abertura)::timestamp with time zone)) / (60)::numeric) AS minutos_aberto,
    ((lpad((floor((EXTRACT(epoch FROM (now() - (data_abertura)::timestamp with time zone)) / (3600)::numeric)))::text, 2, '0'::text) || ':'::text) || lpad((floor(mod((EXTRACT(epoch FROM (now() - (data_abertura)::timestamp with time zone)) / (60)::numeric), (60)::numeric)))::text, 2, '0'::text)) AS tempo_aberto_formatado
   FROM public.chamados c
  WHERE ((status)::text = ANY (ARRAY[('aberto'::character varying)::text, ('em_atendimento'::character varying)::text]))
  ORDER BY
        CASE status
            WHEN 'aberto'::text THEN 0
            ELSE 1
        END, data_abertura;


--
-- Name: vw_chamados_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_chamados_dashboard AS
 SELECT count(*) FILTER (WHERE ((status)::text = 'aberto'::text)) AS total_abertos,
    count(*) FILTER (WHERE ((status)::text = 'em_atendimento'::text)) AS total_em_atendimento,
    count(*) FILTER (WHERE (((status)::text = 'fechado'::text) AND (data_fechamento >= date_trunc('day'::text, now())))) AS fechados_hoje,
    count(*) FILTER (WHERE (((status)::text = ANY (ARRAY[('aberto'::character varying)::text, ('em_atendimento'::character varying)::text])) AND (visualizado = false))) AS nao_visualizados,
    count(*) FILTER (WHERE (data_abertura >= date_trunc('day'::text, now()))) AS abertos_hoje,
    round(avg((EXTRACT(epoch FROM (data_fechamento - data_abertura)) / (60)::numeric)) FILTER (WHERE (((status)::text = 'fechado'::text) AND (data_fechamento >= date_trunc('day'::text, now())))), 1) AS tempo_medio_atendimento_min,
    count(*) FILTER (WHERE (data_abertura >= date_trunc('month'::text, now()))) AS total_mes,
    count(*) FILTER (WHERE (((status)::text = 'fechado'::text) AND (data_fechamento >= date_trunc('month'::text, now())))) AS fechados_mes
   FROM public.chamados;


--
-- Name: vw_chamados_recentes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_chamados_recentes AS
 SELECT id,
    numero_kora,
    nome_solicitante,
    local_problema,
    setor,
    hostname,
    ip,
    problema_descricao,
    observacao_abertura,
    data_abertura,
    data_fechamento,
    tecnico_atendimento,
    observacao_fechamento,
    status,
    prioridade,
    (EXTRACT(epoch FROM (COALESCE((data_fechamento)::timestamp with time zone, now()) - (data_abertura)::timestamp with time zone)) / (60)::numeric) AS minutos_total,
    ((lpad((floor((EXTRACT(epoch FROM (COALESCE((data_fechamento)::timestamp with time zone, now()) - (data_abertura)::timestamp with time zone)) / (3600)::numeric)))::text, 2, '0'::text) || ':'::text) || lpad((floor(mod((EXTRACT(epoch FROM (COALESCE((data_fechamento)::timestamp with time zone, now()) - (data_abertura)::timestamp with time zone)) / (60)::numeric), (60)::numeric)))::text, 2, '0'::text)) AS tempo_total_formatado
   FROM public.chamados c
  WHERE (data_abertura >= (now() - '24:00:00'::interval))
  ORDER BY data_abertura DESC;


--
-- Name: vw_cirurgias_dia; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_cirurgias_dia AS
 SELECT dt_agenda,
    ds_agenda,
    cd_agenda,
    evento_codigo,
    evento_descricao,
    evento,
    nr_minuto_duracao,
    inicio_cirurgia,
    tempo,
    nm_paciente_pf,
    ds_convenio,
    nm_medico,
    ds_idade_abrev,
    setor_cirurgia,
    nm_instrumentador,
    nm_circulante,
    dt_entrada_tasy,
    nr_atendimento,
    nr_cirurgia,
    cd_pessoa_fisica,
    nr_sequencia,
    ie_origem_proced,
    ie_tipo_classif,
    unidade_atendimento,
    ds_tipo_atendimento,
    hr_inicio,
    to_char(((dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval) + ((nr_minuto_duracao || ' minutes'::text))::interval), 'HH24:MI'::text) AS previsao_termino,
    nr_seq_proc_interno,
    ie_cancelada,
    nr_prescr_agenda,
    ds_proc_cir,
    ie_status_cirurgia,
    ds_status,
    nr_prescricao,
    ie_tipo_atendimento,
    cd_medico,
    cd_procedimento,
    ds_carater_cirurgia,
    cd_tipo_agenda,
    cd_estabelecimento,
    ie_status_agenda,
    dt_carga,
    (dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval) AS timestamp_completo,
        CASE
            WHEN ((EXTRACT(hour FROM (dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval)) >= (6)::numeric) AND (EXTRACT(hour FROM (dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval)) <= (11)::numeric)) THEN 'Manhã'::text
            WHEN ((EXTRACT(hour FROM (dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval)) >= (12)::numeric) AND (EXTRACT(hour FROM (dt_agenda + (((hr_inicio)::text || ' minutes'::text))::interval)) <= (17)::numeric)) THEN 'Tarde'::text
            ELSE 'Noite'::text
        END AS periodo_dia,
        CASE
            WHEN (evento_codigo = ANY (ARRAY[14, 16])) THEN true
            ELSE false
        END AS cirurgia_finalizada,
        CASE
            WHEN ((tempo IS NOT NULL) AND ((tempo)::text <> '::'::text) AND (evento_codigo <> ALL (ARRAY[14, 16]))) THEN true
            ELSE false
        END AS cirurgia_em_andamento
   FROM public.agenda_paciente_cirurgias
  WHERE ((dt_agenda >= (CURRENT_DATE - '7 days'::interval)) AND (dt_agenda <= (CURRENT_DATE + '30 days'::interval)));


--
-- Name: vw_destinatarios_completo; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_destinatarios_completo AS
 SELECT d.id,
    d.tipo_evento,
    te.nome AS tipo_evento_nome,
    te.icone AS tipo_evento_icone,
    te.cor AS tipo_evento_cor,
    d.nome,
    d.email,
    d.especialidade,
    d.setor,
    d.canal,
    d.descricao,
    d.ativo,
    d.criado_por,
    d.dt_criacao,
    d.dt_atualizacao
   FROM (public.notificacoes_destinatarios d
     LEFT JOIN public.notificacoes_tipos_evento te ON (((te.codigo)::text = (d.tipo_evento)::text)))
  ORDER BY d.tipo_evento, d.nome;


--
-- Name: vw_faturamento_diario; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario AS
 SELECT dt_entrada AS data,
    count(DISTINCT nr_atendimento) AS qt_atendimentos,
    count(*) AS qt_itens,
    sum(vl_produzido) AS vl_total,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'MATERIAIS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_materiais,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'MEDICAMENTOS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_medicamentos,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'PROCEDIMENTO'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_procedimentos,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'DIARIAS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_diarias,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'TAXAS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_taxas,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'HONORARIO'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_honorarios,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'LABORATORIO'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_laboratorio,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'RADIOLOGIA'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_radiologia,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'SADT'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_sadt,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'OPME'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_opme,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'GASES'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_gases,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'DIETAS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_dietas,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'PACOTE'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_pacotes,
    sum(
        CASE
            WHEN ((grupo_receita)::text = 'EXTRAS'::text) THEN vl_produzido
            ELSE (0)::numeric
        END) AS vl_extras,
        CASE
            WHEN (count(DISTINCT nr_atendimento) > 0) THEN (sum(vl_produzido) / (count(DISTINCT nr_atendimento))::numeric)
            ELSE (0)::numeric
        END AS ticket_medio,
    round(((sum(
        CASE
            WHEN (flag_definitiva = 1) THEN vl_produzido
            ELSE (0)::numeric
        END) / NULLIF(sum(vl_produzido), (0)::numeric)) * (100)::numeric), 2) AS pct_definitivo
   FROM public.ml_faturamento
  GROUP BY dt_entrada;


--
-- Name: vw_faturamento_diario_clinica; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_clinica AS
 SELECT dt_entrada AS data,
    ds_clinica,
    count(DISTINCT nr_atendimento) AS qt_atendimentos,
    sum(vl_produzido) AS vl_total
   FROM public.ml_faturamento
  GROUP BY dt_entrada, ds_clinica;


--
-- Name: vw_faturamento_diario_convenio; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_convenio AS
 SELECT dt_entrada AS data,
    cd_convenio,
    count(DISTINCT nr_atendimento) AS qt_atendimentos,
    sum(vl_produzido) AS vl_total
   FROM public.ml_faturamento
  GROUP BY dt_entrada, cd_convenio;


--
-- Name: vw_faturamento_diario_segmentado; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_segmentado AS
 SELECT f.dt_entrada AS data,
    f.tipo_atendimento,
    COALESCE(m.categoria_setor, 'OUTROS'::character varying) AS categoria_setor,
    count(DISTINCT f.nr_atendimento) AS qt_atendimentos,
    count(*) AS qt_itens,
    sum(f.vl_produzido) AS vl_total,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'MATERIAIS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_materiais,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'MEDICAMENTOS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_medicamentos,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'PROCEDIMENTO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_procedimentos,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'DIARIAS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_diarias,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'TAXAS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_taxas,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'HONORARIO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_honorarios,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'LABORATORIO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_laboratorio,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'RADIOLOGIA'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_radiologia,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'SADT'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_sadt,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'OPME'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_opme,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'PACOTE'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_pacotes
   FROM (public.ml_faturamento f
     LEFT JOIN public.ml_faturamento_setor_mapping m ON ((m.cd_setor = f.cd_setor_conta)))
  GROUP BY f.dt_entrada, f.tipo_atendimento, COALESCE(m.categoria_setor, 'OUTROS'::character varying);


--
-- Name: vw_faturamento_diario_setor; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_setor AS
 SELECT dt_entrada AS data,
    cd_setor_conta AS cd_setor,
    count(DISTINCT nr_atendimento) AS qt_atendimentos,
    sum(vl_produzido) AS vl_total
   FROM public.ml_faturamento
  GROUP BY dt_entrada, cd_setor_conta;


--
-- Name: vw_faturamento_diario_tipo; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_tipo AS
 SELECT f.dt_entrada AS data,
    f.tipo_atendimento,
    count(DISTINCT f.nr_atendimento) AS qt_atendimentos,
    count(*) AS qt_itens,
    sum(f.vl_produzido) AS vl_total,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'UTI'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_uti,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'INTERNACAO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_internacao_setor,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'CENTRO_CIRURGICO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_centro_cirurgico,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'HEMODINAMICA'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_hemodinamica,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'PRONTO_SOCORRO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_ps_setor,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'RADIOLOGIA'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_radiologia_setor,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'LABORATORIO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_laboratorio_setor,
    sum(
        CASE
            WHEN ((m.categoria_setor)::text = 'AMBULATORIO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_ambulatorio_setor,
    count(DISTINCT
        CASE
            WHEN ((m.categoria_setor)::text = 'UTI'::text) THEN f.nr_atendimento
            ELSE NULL::bigint
        END) AS qt_atend_uti,
    count(DISTINCT
        CASE
            WHEN ((m.categoria_setor)::text = 'INTERNACAO'::text) THEN f.nr_atendimento
            ELSE NULL::bigint
        END) AS qt_atend_internacao_setor,
    count(DISTINCT
        CASE
            WHEN ((m.categoria_setor)::text = 'CENTRO_CIRURGICO'::text) THEN f.nr_atendimento
            ELSE NULL::bigint
        END) AS qt_atend_cc,
    count(DISTINCT
        CASE
            WHEN ((m.categoria_setor)::text = 'HEMODINAMICA'::text) THEN f.nr_atendimento
            ELSE NULL::bigint
        END) AS qt_atend_hemodinamica,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'MATERIAIS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_materiais,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'MEDICAMENTOS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_medicamentos,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'PROCEDIMENTO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_procedimentos,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'DIARIAS'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_diarias,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'HONORARIO'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_honorarios,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'OPME'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_opme,
    sum(
        CASE
            WHEN ((f.grupo_receita)::text = 'PACOTE'::text) THEN f.vl_produzido
            ELSE (0)::numeric
        END) AS vl_pacotes,
        CASE
            WHEN (count(DISTINCT f.nr_atendimento) > 0) THEN (sum(f.vl_produzido) / (count(DISTINCT f.nr_atendimento))::numeric)
            ELSE (0)::numeric
        END AS ticket_medio,
    round(((sum(
        CASE
            WHEN (f.flag_definitiva = 1) THEN f.vl_produzido
            ELSE (0)::numeric
        END) / NULLIF(sum(f.vl_produzido), (0)::numeric)) * (100)::numeric), 2) AS pct_definitivo
   FROM (public.ml_faturamento f
     LEFT JOIN public.ml_faturamento_setor_mapping m ON ((m.cd_setor = f.cd_setor_conta)))
  GROUP BY f.dt_entrada, f.tipo_atendimento;


--
-- Name: vw_faturamento_diario_tipo_atend; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_tipo_atend AS
 SELECT dt_entrada AS data,
    tipo_atendimento,
    count(DISTINCT nr_atendimento) AS qt_atendimentos,
    sum(vl_produzido) AS vl_total
   FROM public.ml_faturamento
  GROUP BY dt_entrada, tipo_atendimento;


--
-- Name: vw_faturamento_diario_total; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_faturamento_diario_total AS
 SELECT data,
    sum(qt_atendimentos) AS qt_atendimentos_total,
    sum(vl_total) AS vl_total,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Internado'::text) THEN vl_total
            ELSE (0)::numeric
        END) AS vl_internado,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Pronto socorro'::text) THEN vl_total
            ELSE (0)::numeric
        END) AS vl_ps,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Atendimento Ambulatorial'::text) THEN vl_total
            ELSE (0)::numeric
        END) AS vl_ambulatorial,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Externo'::text) THEN vl_total
            ELSE (0)::numeric
        END) AS vl_externo,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Internado'::text) THEN qt_atendimentos
            ELSE (0)::bigint
        END) AS qt_atend_internado,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Pronto socorro'::text) THEN qt_atendimentos
            ELSE (0)::bigint
        END) AS qt_atend_ps,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Atendimento Ambulatorial'::text) THEN qt_atendimentos
            ELSE (0)::bigint
        END) AS qt_atend_ambulatorial,
    sum(
        CASE
            WHEN ((tipo_atendimento)::text = 'Externo'::text) THEN qt_atendimentos
            ELSE (0)::bigint
        END) AS qt_atend_externo
   FROM public.vw_faturamento_diario_tipo
  GROUP BY data;


--
-- Name: vw_leitos_disponiveis; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_leitos_disponiveis AS
 SELECT cd_unidade_basica AS leito,
    "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" AS setor,
    ds_tipo_acomodacao AS tipo_acomodacao,
    ie_status_unidade AS status_leito,
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 'Disponível'::text
            WHEN (ie_status_unidade = 'H'::bpchar) THEN 'Em Higienização'::text
            WHEN (ie_status_unidade = 'I'::bpchar) THEN 'Interditado'::text
            ELSE NULL::text
        END AS status
   FROM public.ocupacao_hospitalar
  WHERE (ie_status_unidade = ANY (ARRAY['L'::bpchar, 'H'::bpchar, 'I'::bpchar]))
  ORDER BY "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)",
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 1
            WHEN (ie_status_unidade = 'H'::bpchar) THEN 2
            WHEN (ie_status_unidade = 'I'::bpchar) THEN 3
            ELSE NULL::integer
        END, cd_unidade_basica;


--
-- Name: vw_notificacoes_resumo; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_notificacoes_resumo AS
 SELECT tipo_evento,
    count(*) AS total_envios,
    count(*) FILTER (WHERE ((status)::text = 'notificado'::text)) AS envios_ok,
    count(*) FILTER (WHERE ((status)::text = 'erro'::text)) AS envios_erro,
    max(dt_detectado) AS ultimo_envio,
    round((((count(*) FILTER (WHERE ((status)::text = 'notificado'::text)))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS taxa_sucesso
   FROM public.notificacoes_log
  WHERE (dt_detectado >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY tipo_evento;


--
-- Name: vw_notificacoes_timeline; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_notificacoes_timeline AS
 SELECT l.id,
    l.tipo_evento,
    COALESCE(te.nome,
        CASE l.tipo_evento
            WHEN 'parecer_email'::text THEN 'Parecer Email'::character varying
            WHEN 'admissao_nova'::text THEN 'Nova Admissao'::character varying
            WHEN 'parecer_pendente'::text THEN 'Parecer Pendente'::character varying
            WHEN 'prescricao_pendente'::text THEN 'Prescricao Pendente'::character varying
            ELSE l.tipo_evento
        END) AS tipo_evento_nome,
    COALESCE(te.icone, 'fa-bell'::character varying) AS tipo_evento_icone,
    COALESCE(te.cor, '#dc3545'::character varying) AS tipo_evento_cor,
    ((COALESCE(l.nm_paciente, ''::character varying))::text ||
        CASE
            WHEN ((l.nm_setor IS NOT NULL) AND ((l.nm_setor)::text <> ''::text)) THEN (' - '::text || (l.nm_setor)::text)
            ELSE ''::text
        END) AS titulo,
    COALESCE(l.dados_extra, '{}'::jsonb) AS destinatarios_emails,
    l.qt_notificacoes AS qt_destinatarios,
        CASE
            WHEN ((l.tipo_evento)::text = 'parecer_email'::text) THEN 'email'::text
            ELSE 'ntfy'::text
        END AS canal,
        CASE
            WHEN ((l.status)::text = 'notificado'::text) THEN true
            ELSE false
        END AS sucesso,
        CASE
            WHEN ((l.status)::text = 'erro'::text) THEN COALESCE(l.resposta_ntfy, 'Erro desconhecido'::text)
            ELSE NULL::text
        END AS erro_mensagem,
    l.resposta_ntfy AS detalhe_resposta,
    l.dt_detectado AS dt_envio,
    to_char(l.dt_detectado, 'DD/MM/YYYY HH24:MI'::text) AS dt_envio_fmt
   FROM (public.notificacoes_log l
     LEFT JOIN public.notificacoes_tipos_evento te ON (((te.codigo)::text = (l.tipo_evento)::text)))
  ORDER BY l.dt_detectado DESC;


--
-- Name: vw_ocupacao_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ocupacao_dashboard AS
 SELECT (count(*))::integer AS total_leitos,
    (count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_fixos,
    (count(
        CASE
            WHEN (ie_temporario = 'S'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_temporarios,
    (count(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_ocupados,
    (count(
        CASE
            WHEN ((ie_status_unidade = 'P'::bpchar) AND (ie_temporario = 'N'::bpchar)) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_ocupados_fixos,
    (count(
        CASE
            WHEN ((ie_status_unidade = 'P'::bpchar) AND (ie_temporario = 'S'::bpchar)) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_ocupados_temporarios,
    (count(
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_livres,
    (count(
        CASE
            WHEN (ie_status_unidade = 'H'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_higienizacao,
    (count(
        CASE
            WHEN (ie_status_unidade = 'I'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_interditados,
    round((((count(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 2) AS taxa_ocupacao_geral,
    round((((count(
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 2) AS taxa_disponibilidade,
    (count(DISTINCT cd_setor_atendimento))::integer AS total_setores,
    round(avg(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN qt_dia_permanencia
            ELSE NULL::numeric
        END), 1) AS media_permanencia_geral,
    max(dt_carga) AS ultima_atualizacao
   FROM public.ocupacao_hospitalar
  WHERE (cd_setor_atendimento <> ALL (ARRAY[184, 168]));


--
-- Name: vw_ocupacao_hospitalar; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ocupacao_hospitalar AS
 SELECT id,
    nr_atendimento,
    dt_entrada_unidade,
    dt_entrada_unid,
    cd_unidade,
    cd_unidade_basica AS leito,
    nm_pessoa_fisica AS paciente,
    cd_setor_atendimento,
    "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" AS setor,
    dt_nascimento,
    (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (dt_nascimento)::timestamp with time zone)))::integer AS idade,
    ie_sexo AS sexo,
    ds_convenio AS convenio,
    nr_crm,
    nm_guerra AS medico,
    qt_dia_permanencia AS dias_internado,
    ds_clinica AS clinica,
    dt_alta_medico,
    ds_tipo_acomodacao AS tipo_acomodacao,
    classif,
    ie_status_unidade AS status_leito,
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 'Ocupado'::text
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 'Livre'::text
            WHEN (ie_status_unidade = 'H'::bpchar) THEN 'Higienização'::text
            WHEN (ie_status_unidade = 'I'::bpchar) THEN 'Interditado'::text
            ELSE 'Desconhecido'::text
        END AS status_leito_desc,
    dt_carga
   FROM public.ocupacao_hospitalar;


--
-- Name: vw_ocupacao_por_setor; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ocupacao_por_setor AS
 SELECT cd_setor_atendimento,
    "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" AS nm_setor,
    (count(*))::integer AS total_leitos,
    (count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_fixos,
    (count(
        CASE
            WHEN (ie_temporario = 'S'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_temporarios,
    (count(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_ocupados,
    (count(
        CASE
            WHEN ((ie_status_unidade = 'P'::bpchar) AND (ie_temporario = 'S'::bpchar)) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_ocupados_temporarios,
    (count(
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_livres,
    (count(
        CASE
            WHEN (ie_status_unidade = 'H'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_higienizacao,
    (count(
        CASE
            WHEN (ie_status_unidade = 'I'::bpchar) THEN 1
            ELSE NULL::integer
        END))::integer AS leitos_interditados,
    round((((count(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 2) AS taxa_ocupacao,
    round((((count(
        CASE
            WHEN (ie_status_unidade = 'L'::bpchar) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 2) AS taxa_disponibilidade,
    round(avg(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN qt_dia_permanencia
            ELSE NULL::numeric
        END), 1) AS media_permanencia
   FROM public.ocupacao_hospitalar
  GROUP BY cd_setor_atendimento, "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)"
  ORDER BY (round((((count(
        CASE
            WHEN (ie_status_unidade = 'P'::bpchar) THEN 1
            ELSE NULL::integer
        END))::numeric / (NULLIF(count(
        CASE
            WHEN (ie_temporario = 'N'::bpchar) THEN 1
            ELSE NULL::integer
        END), 0))::numeric) * (100)::numeric), 2)) DESC NULLS LAST;


--
-- Name: vw_p27_resumo_paciente; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_p27_resumo_paciente AS
 SELECT p.nr_atendimento,
    p.nm_paciente,
    p.idade,
    p.ie_sexo,
    p.convenio,
    p.nm_medico_resp,
    p.cd_cid_principal,
    p.status_paciente,
    p.nm_setor,
    p.cd_leito,
    p.clinica_setor,
    p.dias_internacao,
    p.dt_entrada_hosp,
    p.dt_alta,
    p.pa_sistolica,
    p.pa_diastolica,
    p.freq_cardiaca,
    p.freq_resp,
    p.temperatura,
    p.saturacao_o2,
    p.glicemia_capilar,
    p.escala_dor,
    p.dt_ultimo_sinal_vital,
    max((
        CASE
            WHEN ((e.cd_exame = 279) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS hemoglobina,
    max((
        CASE
            WHEN ((e.cd_exame = 536) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS hemacias,
    max((
        CASE
            WHEN ((e.cd_exame = 1436) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS ureia,
    max((
        CASE
            WHEN ((e.cd_exame = 1438) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS creatinina,
    max((
        CASE
            WHEN ((e.cd_exame = 1528) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS sodio,
    max((
        CASE
            WHEN ((e.cd_exame = 1529) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS potassio,
    max((
        CASE
            WHEN ((e.cd_exame = 1531) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS calcio_ionico,
    max((
        CASE
            WHEN ((e.cd_exame = 1465) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS magnesio,
    max((
        CASE
            WHEN ((e.cd_exame = 1532) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS fosforo,
    max((
        CASE
            WHEN ((e.cd_exame = 2001) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS leucocitos,
    max((
        CASE
            WHEN ((e.cd_exame = 1738) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS plaquetas,
    max((
        CASE
            WHEN ((e.cd_exame = 3631) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS lactato_art,
    max((
        CASE
            WHEN ((e.cd_exame = 3634) AND (e.rn_recencia = 1)) THEN e.resultado_texto
            ELSE NULL::character varying
        END)::text) AS lactato_ven
   FROM (public.p27_pacientes p
     LEFT JOIN public.p27_exames_lab e ON (((e.nr_atendimento = p.nr_atendimento) AND (e.rn_recencia <= 1))))
  GROUP BY p.nr_atendimento, p.nm_paciente, p.idade, p.ie_sexo, p.convenio, p.nm_medico_resp, p.cd_cid_principal, p.status_paciente, p.nm_setor, p.cd_leito, p.clinica_setor, p.dias_internacao, p.dt_entrada_hosp, p.dt_alta, p.pa_sistolica, p.pa_diastolica, p.freq_cardiaca, p.freq_resp, p.temperatura, p.saturacao_o2, p.glicemia_capilar, p.escala_dor, p.dt_ultimo_sinal_vital
  ORDER BY
        CASE
            WHEN ((p.status_paciente)::text = 'INTERNADO'::text) THEN 0
            ELSE 1
        END, p.nm_setor, p.cd_leito;


--
-- Name: vw_p27_serie_exames; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_p27_serie_exames AS
 SELECT nr_atendimento,
    cd_exame,
    nm_exame,
    resultado_texto,
    resultado_numerico,
    dt_coleta,
    dt_resultado,
    rn_recencia
   FROM public.p27_exames_lab
  WHERE (rn_recencia <= 3)
  ORDER BY nr_atendimento, cd_exame, rn_recencia;


--
-- Name: vw_pacientes_internados; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_pacientes_internados AS
 SELECT nr_atendimento,
    cd_unidade_basica AS leito,
    nm_pessoa_fisica AS paciente,
    "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" AS setor,
    ds_convenio AS convenio,
    nm_guerra AS medico,
    dt_entrada_unidade,
    qt_dia_permanencia AS dias_internado,
    ds_tipo_acomodacao AS tipo_acomodacao,
    ie_sexo AS sexo,
    (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (dt_nascimento)::timestamp with time zone)))::integer AS idade,
    ds_clinica AS clinica,
    classif AS classificacao
   FROM public.ocupacao_hospitalar
  WHERE (ie_status_unidade = 'P'::bpchar)
  ORDER BY "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)", cd_unidade_basica;


--
-- Name: vw_painel12_cirurgias_mes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_cirurgias_mes AS
 SELECT (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date AS mes_referencia,
    count(*) AS total_procedimentos,
    count(*) FILTER (WHERE ((setor)::text = 'CENTRO CIRURGICO'::text)) AS total_cirurgias,
    count(*) FILTER (WHERE ((setor)::text = 'HEMODINAMICA'::text)) AS total_hemodinamica,
    count(*) FILTER (WHERE (((status_cirurgia)::text ~~ '%REALIZADA%'::text) OR ((status_cirurgia)::text ~~ '%CONCLUIDA%'::text))) AS procedimentos_realizados,
    count(*) FILTER (WHERE (((status_cirurgia)::text ~~ '%AGENDADA%'::text) OR ((status_cirurgia)::text ~~ '%PREVISTA%'::text))) AS procedimentos_agendados,
    count(*) FILTER (WHERE ((status_cirurgia)::text ~~ '%CANCELADA%'::text)) AS procedimentos_cancelados,
    round(avg(tempo_cirurgia_min) FILTER (WHERE (tempo_cirurgia_min > (0)::numeric)), 1) AS tempo_medio_min,
    round(avg(tempo_cirurgia_min) FILTER (WHERE (((setor)::text = 'CENTRO CIRURGICO'::text) AND (tempo_cirurgia_min > (0)::numeric))), 1) AS tempo_medio_cc_min,
    round(avg(tempo_cirurgia_min) FILTER (WHERE (((setor)::text = 'HEMODINAMICA'::text) AND (tempo_cirurgia_min > (0)::numeric))), 1) AS tempo_medio_hemo_min,
    round(((count(*) FILTER (WHERE ((setor)::text = 'CENTRO CIRURGICO'::text)))::numeric / NULLIF(EXTRACT(day FROM CURRENT_DATE), (0)::numeric)), 1) AS media_cirurgias_dia,
    round(((count(*) FILTER (WHERE ((setor)::text = 'HEMODINAMICA'::text)))::numeric / NULLIF(EXTRACT(day FROM CURRENT_DATE), (0)::numeric)), 1) AS media_hemodinamica_dia,
    (EXTRACT(day FROM CURRENT_DATE))::integer AS dias_corridos,
    CURRENT_TIMESTAMP AS dt_atualizacao
   FROM public.painel_cirurgias_hemodinamica
  WHERE (mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date);


--
-- Name: vw_painel12_producao_mes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_producao_mes AS
 SELECT (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date AS mes_referencia,
    COALESCE(sum(vl_produzido), (0)::numeric) AS producao_mes_corrente,
    COALESCE(sum((vl_custo_medio * quantidade)), (0)::numeric) AS custo_total_mes,
    (EXTRACT(day FROM (CURRENT_DATE - 1)))::integer AS dias_corridos,
    (EXTRACT(day FROM (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval)))::integer AS total_dias_mes,
    ((EXTRACT(day FROM (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval)))::integer - (EXTRACT(day FROM (CURRENT_DATE - 1)))::integer) AS dias_restantes,
    round((COALESCE(sum(vl_produzido), (0)::numeric) / NULLIF(EXTRACT(day FROM (CURRENT_DATE - 1)), (0)::numeric)), 2) AS producao_media_dia,
    round(((COALESCE(sum(vl_produzido), (0)::numeric) / NULLIF(EXTRACT(day FROM (CURRENT_DATE - 1)), (0)::numeric)) * ((EXTRACT(day FROM (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval)))::integer)::numeric), 2) AS projecao_fim_mes,
    CURRENT_TIMESTAMP AS dt_atualizacao
   FROM public.painel_producao_mensal
  WHERE (mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date);


--
-- Name: vw_painel12_ps_atendimentos_mes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_ps_atendimentos_mes AS
 SELECT (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date AS mes_referencia,
    count(nr_atendimento) AS total_atendimentos,
    count(DISTINCT
        CASE
            WHEN (date(dt_entrada) = CURRENT_DATE) THEN nr_atendimento
            ELSE NULL::character varying
        END) AS atendimentos_hoje,
    (EXTRACT(day FROM CURRENT_DATE))::integer AS dias_corridos,
    round(((count(DISTINCT nr_atendimento))::numeric / NULLIF(EXTRACT(day FROM CURRENT_DATE), (0)::numeric)), 0) AS media_dia,
    CURRENT_TIMESTAMP AS dt_atualizacao
   FROM public.painel_ps_atendimentos
  WHERE ((dt_entrada >= date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone)) AND (dt_entrada < (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)));


--
-- Name: vw_painel12_ps_conversao_mes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_ps_conversao_mes AS
 SELECT (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date AS mes_referencia,
    count(DISTINCT nr_atendimento_ps) AS total_conversoes,
    ( SELECT count(DISTINCT painel_ps_atendimentos.nr_atendimento) AS count
           FROM public.painel_ps_atendimentos
          WHERE (painel_ps_atendimentos.mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date)) AS total_atendimentos_ps,
    round((((count(DISTINCT nr_atendimento_ps))::numeric / (NULLIF(( SELECT count(DISTINCT painel_ps_atendimentos.nr_atendimento) AS count
           FROM public.painel_ps_atendimentos
          WHERE (painel_ps_atendimentos.mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date)), 0))::numeric) * (100)::numeric), 1) AS percentual_conversao,
    round((avg(tempo_ate_internacao_min) / (60)::numeric), 1) AS tempo_medio_internacao_horas,
    CURRENT_TIMESTAMP AS dt_atualizacao
   FROM public.painel_ps_conversao_internacao
  WHERE (mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date);


--
-- Name: vw_painel12_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_dashboard AS
 SELECT COALESCE(( SELECT vw_ocupacao_dashboard.total_leitos
           FROM public.vw_ocupacao_dashboard), 0) AS total_leitos,
    COALESCE(( SELECT vw_ocupacao_dashboard.leitos_fixos
           FROM public.vw_ocupacao_dashboard), 0) AS leitos_fixos,
    COALESCE(( SELECT vw_ocupacao_dashboard.leitos_temporarios
           FROM public.vw_ocupacao_dashboard), 0) AS leitos_temporarios,
    COALESCE(( SELECT vw_ocupacao_dashboard.leitos_ocupados
           FROM public.vw_ocupacao_dashboard), 0) AS leitos_ocupados,
    COALESCE(( SELECT vw_ocupacao_dashboard.leitos_ocupados_temporarios
           FROM public.vw_ocupacao_dashboard), 0) AS leitos_ocupados_temporarios,
    COALESCE(( SELECT vw_ocupacao_dashboard.taxa_ocupacao_geral
           FROM public.vw_ocupacao_dashboard), (0)::numeric) AS taxa_ocupacao,
    COALESCE(( SELECT vw_painel12_ps_atendimentos_mes.total_atendimentos
           FROM public.vw_painel12_ps_atendimentos_mes), (0)::bigint) AS ps_atendimentos_mes,
    COALESCE(( SELECT vw_painel12_ps_atendimentos_mes.atendimentos_hoje
           FROM public.vw_painel12_ps_atendimentos_mes), (0)::bigint) AS ps_atendimentos_hoje,
    COALESCE(( SELECT vw_painel12_ps_atendimentos_mes.media_dia
           FROM public.vw_painel12_ps_atendimentos_mes), (0)::numeric) AS ps_media_dia,
    COALESCE(( SELECT vw_painel12_ps_conversao_mes.total_conversoes
           FROM public.vw_painel12_ps_conversao_mes), (0)::bigint) AS conversoes_mes,
    COALESCE(( SELECT vw_painel12_ps_conversao_mes.total_atendimentos_ps
           FROM public.vw_painel12_ps_conversao_mes), (0)::bigint) AS conversoes_base_total,
    COALESCE(( SELECT vw_painel12_ps_conversao_mes.percentual_conversao
           FROM public.vw_painel12_ps_conversao_mes), (0)::numeric) AS conversoes_percentual,
    COALESCE(( SELECT vw_painel12_ps_conversao_mes.tempo_medio_internacao_horas
           FROM public.vw_painel12_ps_conversao_mes), (0)::numeric) AS tempo_medio_internacao_h,
    COALESCE(( SELECT vw_painel12_producao_mes.producao_mes_corrente
           FROM public.vw_painel12_producao_mes), (0)::numeric) AS producao_mes,
    COALESCE(( SELECT vw_painel12_producao_mes.producao_media_dia
           FROM public.vw_painel12_producao_mes), (0)::numeric) AS producao_media_dia,
    COALESCE(( SELECT vw_painel12_producao_mes.projecao_fim_mes
           FROM public.vw_painel12_producao_mes), (0)::numeric) AS projecao_mes,
    COALESCE(( SELECT vw_painel12_producao_mes.dias_corridos
           FROM public.vw_painel12_producao_mes), 0) AS dias_corridos,
    COALESCE(( SELECT vw_painel12_producao_mes.dias_restantes
           FROM public.vw_painel12_producao_mes), 0) AS dias_restantes,
    COALESCE(( SELECT vw_painel12_producao_mes.producao_media_dia
           FROM public.vw_painel12_producao_mes), (0)::numeric) AS tendencia_diaria,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.total_cirurgias
           FROM public.vw_painel12_cirurgias_mes), (0)::bigint) AS cirurgias_mes,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.media_cirurgias_dia
           FROM public.vw_painel12_cirurgias_mes), (0)::numeric) AS cirurgias_media_dia,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.tempo_medio_cc_min
           FROM public.vw_painel12_cirurgias_mes), (0)::numeric) AS cirurgias_tempo_medio_min,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.total_hemodinamica
           FROM public.vw_painel12_cirurgias_mes), (0)::bigint) AS hemodinamica_mes,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.media_hemodinamica_dia
           FROM public.vw_painel12_cirurgias_mes), (0)::numeric) AS hemodinamica_media_dia,
    COALESCE(( SELECT vw_painel12_cirurgias_mes.tempo_medio_hemo_min
           FROM public.vw_painel12_cirurgias_mes), (0)::numeric) AS hemodinamica_tempo_medio_min,
    CURRENT_TIMESTAMP AS dt_atualizacao;


--
-- Name: vw_painel12_producao_mes_avancada; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel12_producao_mes_avancada AS
 WITH producao_diaria AS (
         SELECT painel_producao_mensal.dt_conta AS dia,
            sum(painel_producao_mensal.vl_produzido) AS producao_dia,
            EXTRACT(dow FROM painel_producao_mensal.dt_conta) AS dia_semana,
            row_number() OVER (ORDER BY painel_producao_mensal.dt_conta DESC) AS recencia
           FROM public.painel_producao_mensal
          WHERE (painel_producao_mensal.mes_referencia = (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date)
          GROUP BY painel_producao_mensal.dt_conta
        ), estatisticas AS (
         SELECT COALESCE(sum(producao_diaria.producao_dia), (0)::numeric) AS producao_total,
            COALESCE(avg(producao_diaria.producao_dia), (0)::numeric) AS media_simples,
            COALESCE((sum(
                CASE
                    WHEN (producao_diaria.recencia <= 7) THEN (producao_diaria.producao_dia * (2)::numeric)
                    ELSE producao_diaria.producao_dia
                END) / (sum(
                CASE
                    WHEN (producao_diaria.recencia <= 7) THEN 2
                    ELSE 1
                END))::numeric), (0)::numeric) AS media_ponderada,
            COALESCE(avg(producao_diaria.producao_dia) FILTER (WHERE ((producao_diaria.dia_semana >= (1)::numeric) AND (producao_diaria.dia_semana <= (5)::numeric))), (0)::numeric) AS media_dias_uteis,
            COALESCE(avg(producao_diaria.producao_dia) FILTER (WHERE (producao_diaria.dia_semana = ANY (ARRAY[(0)::numeric, (6)::numeric]))), (0)::numeric) AS media_fds,
                CASE
                    WHEN (count(*) >= 10) THEN (avg(producao_diaria.producao_dia) FILTER (WHERE (producao_diaria.recencia <= 5)) - avg(producao_diaria.producao_dia) FILTER (WHERE (producao_diaria.recencia > 5)))
                    ELSE (0)::numeric
                END AS tendencia_diaria,
            count(*) AS dias_com_dados,
            count(*) FILTER (WHERE ((producao_diaria.dia_semana >= (1)::numeric) AND (producao_diaria.dia_semana <= (5)::numeric))) AS dias_uteis_passados,
            count(*) FILTER (WHERE (producao_diaria.dia_semana = ANY (ARRAY[(0)::numeric, (6)::numeric]))) AS dias_fds_passados
           FROM producao_diaria
        ), dias_futuros AS (
         SELECT (EXTRACT(day FROM CURRENT_DATE))::integer AS dias_corridos,
            (EXTRACT(day FROM (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval)))::integer AS total_dias_mes,
            count(*) FILTER (WHERE ((EXTRACT(dow FROM dia.dia) >= (1)::numeric) AND (EXTRACT(dow FROM dia.dia) <= (5)::numeric))) AS dias_uteis_restantes,
            count(*) FILTER (WHERE (EXTRACT(dow FROM dia.dia) = ANY (ARRAY[(0)::numeric, (6)::numeric]))) AS dias_fds_restantes
           FROM generate_series(((CURRENT_DATE + 1))::timestamp with time zone, (((date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval))::date)::timestamp with time zone, '1 day'::interval) dia(dia)
        )
 SELECT (date_trunc('MONTH'::text, (CURRENT_DATE)::timestamp with time zone))::date AS mes_referencia,
    e.producao_total AS producao_mes_corrente,
    df.dias_corridos,
    df.total_dias_mes,
    (df.total_dias_mes - df.dias_corridos) AS dias_restantes,
    round(e.media_simples, 2) AS media_simples,
    round(e.media_ponderada, 2) AS media_ponderada,
    round(e.media_dias_uteis, 2) AS media_dias_uteis,
    round(e.media_fds, 2) AS media_fim_semana,
    round(e.tendencia_diaria, 2) AS tendencia_diaria,
    round((e.producao_total + (e.media_simples * ((df.total_dias_mes - df.dias_corridos))::numeric)), 2) AS projecao_metodo_simples,
    round((e.producao_total + (e.media_ponderada * ((df.total_dias_mes - df.dias_corridos))::numeric)), 2) AS projecao_metodo_ponderado,
    round((e.producao_total + ((e.media_ponderada + (e.tendencia_diaria * 0.5)) * ((df.total_dias_mes - df.dias_corridos))::numeric)), 2) AS projecao_metodo_tendencia,
    round(((e.producao_total + (e.media_dias_uteis * (df.dias_uteis_restantes)::numeric)) + (e.media_fds * (df.dias_fds_restantes)::numeric)), 2) AS projecao_metodo_sazonalidade,
    round(((e.producao_total + ((e.media_ponderada * 0.7) * ((df.total_dias_mes - df.dias_corridos))::numeric)) + (((e.media_dias_uteis * (df.dias_uteis_restantes)::numeric) + (e.media_fds * (df.dias_fds_restantes)::numeric)) * 0.3)), 2) AS projecao_recomendada,
    e.dias_com_dados,
    df.dias_uteis_restantes,
    df.dias_fds_restantes,
    CURRENT_TIMESTAMP AS dt_atualizacao
   FROM (estatisticas e
     CROSS JOIN dias_futuros df);


--
-- Name: vw_painel19_radiologia; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel19_radiologia AS
 SELECT id,
    nr_atendimento,
    TRIM(BOTH FROM leito) AS leito,
    TRIM(BOTH FROM leito_base) AS leito_base,
    cd_setor_atendimento,
    nm_setor,
    nm_pessoa_fisica,
    idade,
        CASE
            WHEN (idade IS NOT NULL) THEN (((((nm_pessoa_fisica)::text || ' ('::text) || idade) || 'a)'::text))::character varying
            ELSE nm_pessoa_fisica
        END AS paciente_display,
    ds_convenio,
    ds_tipo_acomodacao,
    nr_prescricao,
    cd_procedimento,
    initcap(TRIM(BOTH FROM ds_procedimento)) AS ds_procedimento,
    nm_medico_solicitante,
    dt_pedido,
    dt_prev_execucao,
    ds_status_execucao,
    dt_execucao,
    nm_executor,
    dt_laudo,
    dt_laudo_liberacao,
    nm_laudador,
    ie_status_laudo,
    status_radiologia,
    prioridade_ordem,
    horas_espera,
    ie_urgente,
        CASE
            WHEN (horas_espera IS NULL) THEN '-'::text
            WHEN (horas_espera < (1)::numeric) THEN (round((horas_espera * (60)::numeric)) || 'min'::text)
            WHEN (horas_espera < (24)::numeric) THEN (round(horas_espera, 1) || 'h'::text)
            ELSE (((floor((horas_espera / (24)::numeric)) || 'd '::text) || round(((horas_espera)::numeric % (24)::numeric))) || 'h'::text)
        END AS tempo_espera_display,
        CASE status_radiologia
            WHEN 'AGUARDANDO'::text THEN 'Aguardando Execução'::text
            WHEN 'EXECUTADO_SEM_LAUDO'::text THEN 'Executado - Sem Laudo'::text
            WHEN 'LAUDADO'::text THEN 'Laudado'::text
            ELSE NULL::text
        END AS status_display,
    dt_carga
   FROM public.painel19_radiologia_pendencias p
  ORDER BY cd_setor_atendimento, p.leito_base, prioridade_ordem, dt_pedido DESC;


--
-- Name: vw_painel19_resumo_paciente; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel19_resumo_paciente AS
 SELECT nr_atendimento,
    TRIM(BOTH FROM leito) AS leito,
    TRIM(BOTH FROM leito_base) AS leito_base,
    cd_setor_atendimento,
    nm_setor,
    nm_pessoa_fisica,
    idade,
        CASE
            WHEN (idade IS NOT NULL) THEN (((((nm_pessoa_fisica)::text || ' ('::text) || idade) || 'a)'::text))::character varying
            ELSE nm_pessoa_fisica
        END AS paciente_display,
    ds_convenio,
    ds_tipo_acomodacao,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'AGUARDANDO'::text)) AS qt_aguardando,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'EXECUTADO_SEM_LAUDO'::text)) AS qt_sem_laudo,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'LAUDADO'::text)) AS qt_laudado,
    count(*) AS qt_total_exames,
    max(
        CASE
            WHEN (ie_urgente = 'S'::bpchar) THEN 1
            ELSE 0
        END) AS tem_urgente,
    max(horas_espera) FILTER (WHERE ((status_radiologia)::text = ANY (ARRAY[('AGUARDANDO'::character varying)::text, ('EXECUTADO_SEM_LAUDO'::character varying)::text]))) AS max_horas_espera,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'AGUARDANDO'::text) THEN initcap(TRIM(BOTH FROM ds_procedimento))
            ELSE NULL::text
        END, ', '::text ORDER BY dt_pedido) AS exames_aguardando,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'EXECUTADO_SEM_LAUDO'::text) THEN initcap(TRIM(BOTH FROM ds_procedimento))
            ELSE NULL::text
        END, ', '::text ORDER BY dt_execucao) AS exames_sem_laudo,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'LAUDADO'::text) THEN initcap(TRIM(BOTH FROM ds_procedimento))
            ELSE NULL::text
        END, ', '::text ORDER BY dt_laudo_liberacao DESC) AS exames_laudados
   FROM public.painel19_radiologia_pendencias p
  GROUP BY nr_atendimento, leito, leito_base, cd_setor_atendimento, nm_setor, nm_pessoa_fisica, idade, ds_convenio, ds_tipo_acomodacao
  ORDER BY cd_setor_atendimento, p.leito_base;


--
-- Name: vw_painel20_radiologia; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel20_radiologia AS
 SELECT nr_atendimento,
    dt_entrada,
    horas_no_ps,
    nm_pessoa_fisica,
    idade,
    ds_convenio,
    nm_medico_responsavel,
    nr_prescricao,
    nr_seq_procedimento,
    cd_procedimento,
    TRIM(BOTH FROM ds_procedimento) AS ds_procedimento,
    nm_medico_solicitante,
    dt_pedido,
    dt_prev_execucao,
    ds_status_execucao,
    dt_execucao,
    nm_executor,
    dt_laudo,
    dt_laudo_liberacao,
    nm_laudador,
    ie_status_laudo,
    status_radiologia,
    prioridade_ordem,
    horas_espera,
    ie_urgente,
    to_char(dt_entrada, 'DD/MM HH24:MI'::text) AS entrada_display,
        CASE
            WHEN (horas_no_ps IS NULL) THEN '-'::text
            WHEN (horas_no_ps < (1)::numeric) THEN (round((horas_no_ps * (60)::numeric)) || 'min'::text)
            WHEN (horas_no_ps < (24)::numeric) THEN (round(horas_no_ps, 1) || 'h'::text)
            ELSE (((floor((horas_no_ps / (24)::numeric)) || 'd '::text) || round(mod(horas_no_ps, (24)::numeric))) || 'h'::text)
        END AS tempo_ps_display,
        CASE status_radiologia
            WHEN 'AGUARDANDO'::text THEN 'Aguardando Execucao'::character varying
            WHEN 'EXECUTADO_SEM_LAUDO'::text THEN 'Executado - Sem Laudo'::character varying
            WHEN 'LAUDADO'::text THEN 'Laudado'::character varying
            ELSE status_radiologia
        END AS status_display,
        CASE
            WHEN (horas_espera IS NULL) THEN '-'::text
            WHEN (horas_espera < (1)::numeric) THEN (round((horas_espera * (60)::numeric)) || 'min'::text)
            WHEN (horas_espera < (24)::numeric) THEN (round(horas_espera, 1) || 'h'::text)
            ELSE (((floor((horas_espera / (24)::numeric)) || 'd '::text) || round(mod(horas_espera, (24)::numeric))) || 'h'::text)
        END AS tempo_espera_display
   FROM public.painel20_radiologia_ps;


--
-- Name: vw_painel20_resumo_paciente; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel20_resumo_paciente AS
 SELECT nr_atendimento,
    dt_entrada,
    max(horas_no_ps) AS horas_no_ps,
    max((nm_pessoa_fisica)::text) AS nm_pessoa_fisica,
    max(idade) AS idade,
    max((ds_convenio)::text) AS ds_convenio,
    max((nm_medico_responsavel)::text) AS nm_medico_responsavel,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'AGUARDANDO'::text)) AS qt_aguardando,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'EXECUTADO_SEM_LAUDO'::text)) AS qt_sem_laudo,
    count(*) FILTER (WHERE ((status_radiologia)::text = 'LAUDADO'::text)) AS qt_laudado,
    count(*) AS qt_total_exames,
    max(
        CASE
            WHEN (ie_urgente = 'S'::bpchar) THEN 1
            ELSE 0
        END) AS tem_urgente,
    max(horas_espera) AS max_horas_espera,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'AGUARDANDO'::text) THEN TRIM(BOTH FROM ds_procedimento)
            ELSE NULL::text
        END, ', '::text ORDER BY dt_pedido) AS exames_aguardando,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'EXECUTADO_SEM_LAUDO'::text) THEN TRIM(BOTH FROM ds_procedimento)
            ELSE NULL::text
        END, ', '::text ORDER BY dt_pedido) AS exames_sem_laudo,
    string_agg(
        CASE
            WHEN ((status_radiologia)::text = 'LAUDADO'::text) THEN TRIM(BOTH FROM ds_procedimento)
            ELSE NULL::text
        END, ', '::text ORDER BY dt_pedido) AS exames_laudados,
    to_char(dt_entrada, 'DD/MM HH24:MI'::text) AS entrada_display,
        CASE
            WHEN (max(horas_no_ps) IS NULL) THEN '-'::text
            WHEN (max(horas_no_ps) < (1)::numeric) THEN (round((max(horas_no_ps) * (60)::numeric)) || 'min'::text)
            WHEN (max(horas_no_ps) < (24)::numeric) THEN (round(max(horas_no_ps), 1) || 'h'::text)
            ELSE (((floor((max(horas_no_ps) / (24)::numeric)) || 'd '::text) || round(mod(max(horas_no_ps), (24)::numeric))) || 'h'::text)
        END AS tempo_ps_display
   FROM public.painel20_radiologia_ps
  GROUP BY nr_atendimento, dt_entrada
  ORDER BY dt_entrada;


--
-- Name: vw_painel21_contas; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel21_contas AS
 SELECT id,
    nr_conta,
    nr_atendimento,
    estabelecimento,
    pessoa_fisica,
    tipo_atend,
    ie_tipo,
    status_conta,
    legenda_conta,
    convenio,
    protocolo,
    status_protocolo,
    entrega_convenio,
    vl_conta,
    dt_conta,
    dt_periodo_inicial,
    dt_periodo_final,
    dt_mesano_referencia,
    nr_seq_etapa,
    etapa_conta,
    cd_setor_atendimento,
    setor_atendimento,
    auditoria,
        CASE
            WHEN ((legenda_conta)::text = 'SEM NOTA/TITULO'::text) THEN 1
            WHEN ((legenda_conta)::text = 'EM PROTOCOLO'::text) THEN 2
            WHEN ((legenda_conta)::text = 'PROT.C /TITULO'::text) THEN 3
            WHEN ((legenda_conta)::text = 'PROT.C /NF'::text) THEN 4
            WHEN ((legenda_conta)::text = 'TITULO GERADO'::text) THEN 5
            WHEN ((legenda_conta)::text = 'NOTA FISCAL'::text) THEN 6
            WHEN ((legenda_conta)::text = 'ESTORNADA'::text) THEN 7
            WHEN ((legenda_conta)::text = 'CANCELADA'::text) THEN 8
            ELSE 9
        END AS prioridade_legenda,
    (EXTRACT(day FROM (CURRENT_TIMESTAMP - (dt_periodo_inicial)::timestamp with time zone)))::integer AS dias_aging,
    dt_carga
   FROM public.painel21_contas
  ORDER BY estabelecimento, dt_periodo_inicial DESC, nr_atendimento;


--
-- Name: vw_painel21_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel21_dashboard AS
 SELECT (count(*))::integer AS total_contas,
    (count(DISTINCT nr_atendimento))::integer AS total_atendimentos,
    COALESCE(sum(vl_conta), (0)::numeric) AS vl_total,
    (count(*) FILTER (WHERE ((status_conta)::text = 'Provisório'::text)))::integer AS qt_provisorio,
    (count(*) FILTER (WHERE ((status_conta)::text = 'Definitivo'::text)))::integer AS qt_definitivo,
    COALESCE(sum(vl_conta) FILTER (WHERE ((status_conta)::text = 'Provisório'::text)), (0)::numeric) AS vl_provisorio,
    COALESCE(sum(vl_conta) FILTER (WHERE ((status_conta)::text = 'Definitivo'::text)), (0)::numeric) AS vl_definitivo,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'SEM NOTA/TITULO'::text)))::integer AS qt_sem_nf_titulo,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'EM PROTOCOLO'::text)))::integer AS qt_em_protocolo,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'NOTA FISCAL'::text)))::integer AS qt_nota_fiscal,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'TITULO GERADO'::text)))::integer AS qt_titulo_gerado,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'PROT.C /NF'::text)))::integer AS qt_prot_nf,
    (count(*) FILTER (WHERE ((legenda_conta)::text = 'PROT.C /TITULO'::text)))::integer AS qt_prot_titulo,
    COALESCE(sum(vl_conta) FILTER (WHERE ((legenda_conta)::text = 'SEM NOTA/TITULO'::text)), (0)::numeric) AS vl_sem_nf_titulo,
    COALESCE(sum(vl_conta) FILTER (WHERE ((legenda_conta)::text = 'EM PROTOCOLO'::text)), (0)::numeric) AS vl_em_protocolo,
    (count(*) FILTER (WHERE ((status_protocolo)::text = 'Provisório'::text)))::integer AS qt_protocolo_provisorio,
    (count(*) FILTER (WHERE ((status_protocolo)::text = 'Definitivo'::text)))::integer AS qt_protocolo_definitivo,
    (count(*) FILTER (WHERE ((status_protocolo)::text = 'Auditoria'::text)))::integer AS qt_protocolo_auditoria,
    (count(*) FILTER (WHERE ((status_protocolo)::text = 'Fora Remessa'::text)))::integer AS qt_fora_remessa,
    (count(*) FILTER (WHERE (ie_tipo = 1)))::integer AS qt_internacao,
    (count(*) FILTER (WHERE (ie_tipo = 3)))::integer AS qt_pronto_socorro,
    (count(*) FILTER (WHERE (ie_tipo = 7)))::integer AS qt_externo,
    (count(*) FILTER (WHERE (ie_tipo = 8)))::integer AS qt_ambulatorial,
    COALESCE(sum(vl_conta) FILTER (WHERE (ie_tipo = 1)), (0)::numeric) AS vl_internacao,
    COALESCE(sum(vl_conta) FILTER (WHERE (ie_tipo = 3)), (0)::numeric) AS vl_pronto_socorro,
    COALESCE(sum(vl_conta) FILTER (WHERE (ie_tipo = 7)), (0)::numeric) AS vl_externo,
    COALESCE(sum(vl_conta) FILTER (WHERE (ie_tipo = 8)), (0)::numeric) AS vl_ambulatorial,
    max(dt_carga) AS ultima_atualizacao
   FROM public.painel21_contas;


--
-- Name: vw_painel22_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel22_dashboard AS
 SELECT count(DISTINCT nr_atendimento) AS total_pacientes,
    count(*) AS total_exames,
    count(*) FILTER (WHERE ((tipo_exame)::text = 'RADIOLOGIA'::text)) AS qt_radiologia,
    count(*) FILTER (WHERE ((tipo_exame)::text = 'LABORATORIO'::text)) AS qt_laboratorio,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'RADIOLOGIA'::text) AND ((status_exame)::text = 'AGUARDANDO'::text))) AS qt_radio_aguardando,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'RADIOLOGIA'::text) AND ((status_exame)::text = 'EXECUTADO'::text))) AS qt_radio_executado,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'RADIOLOGIA'::text) AND ((status_exame)::text = 'LAUDADO'::text))) AS qt_radio_laudado,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'LABORATORIO'::text) AND ((status_exame)::text = 'SOLICITADO'::text))) AS qt_lab_solicitado,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'LABORATORIO'::text) AND ((status_exame)::text = 'COLETADO'::text))) AS qt_lab_coletado,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'LABORATORIO'::text) AND ((status_exame)::text = 'EM_ANALISE'::text))) AS qt_lab_em_analise,
    count(*) FILTER (WHERE (((tipo_exame)::text = 'LABORATORIO'::text) AND ((status_exame)::text = ANY (ARRAY[('LIBERADO'::character varying)::text, ('RESULTADO_PARCIAL'::character varying)::text])))) AS qt_lab_liberado,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('AGUARDANDO'::character varying)::text, ('SOLICITADO'::character varying)::text]))) AS qt_pendentes,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('EXECUTADO'::character varying)::text, ('COLETADO'::character varying)::text, ('EM_ANALISE'::character varying)::text, ('RESULTADO_PARCIAL'::character varying)::text]))) AS qt_em_andamento,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))) AS qt_concluidos,
    round(avg(horas_espera) FILTER (WHERE ((status_exame)::text <> ALL (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))), 1) AS media_horas_pendentes,
    round(max(horas_espera) FILTER (WHERE ((status_exame)::text <> ALL (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))), 1) AS max_horas_pendentes
   FROM public.painel22_exames_ps;


--
-- Name: vw_painel22_detalhe; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel22_detalhe AS
 SELECT id,
    nr_atendimento,
    dt_entrada,
    round((EXTRACT(epoch FROM (now() - (dt_entrada)::timestamp with time zone)) / 3600.0), 1) AS horas_no_ps_atual,
    nm_pessoa_fisica,
    idade,
    ds_convenio,
    tipo_exame,
    nr_prescricao,
    nr_seq_procedimento,
    ds_procedimento,
    ds_material,
    dt_pedido,
    dt_coleta_execucao,
    dt_resultado,
    status_exame,
    ds_status,
        CASE
            WHEN (dt_resultado IS NOT NULL) THEN round((EXTRACT(epoch FROM (dt_resultado - dt_pedido)) / 3600.0), 1)
            WHEN (dt_coleta_execucao IS NOT NULL) THEN round((EXTRACT(epoch FROM (now() - (dt_coleta_execucao)::timestamp with time zone)) / 3600.0), 1)
            WHEN (dt_pedido IS NOT NULL) THEN round((EXTRACT(epoch FROM (now() - (dt_pedido)::timestamp with time zone)) / 3600.0), 1)
            ELSE horas_espera
        END AS horas_espera,
    prioridade_ordem,
    dt_carga,
    nm_medico,
    ds_clinica
   FROM public.painel22_exames_ps
  ORDER BY nr_atendimento, prioridade_ordem, dt_pedido;


--
-- Name: vw_painel22_pacientes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel22_pacientes AS
 SELECT nr_atendimento,
    dt_entrada,
    round((EXTRACT(epoch FROM (now() - (dt_entrada)::timestamp with time zone)) / 3600.0), 1) AS horas_no_ps,
    nm_pessoa_fisica,
    idade,
    ds_convenio,
    count(*) AS total_exames,
    count(*) FILTER (WHERE ((tipo_exame)::text = 'RADIOLOGIA'::text)) AS qt_radiologia,
    count(*) FILTER (WHERE ((tipo_exame)::text = 'LABORATORIO'::text)) AS qt_laboratorio,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('AGUARDANDO'::character varying)::text, ('SOLICITADO'::character varying)::text]))) AS qt_pendentes,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('EXECUTADO'::character varying)::text, ('COLETADO'::character varying)::text, ('EM_ANALISE'::character varying)::text, ('RESULTADO_PARCIAL'::character varying)::text]))) AS qt_em_andamento,
    count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))) AS qt_concluidos,
    round((((count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 0) AS pct_concluido,
    round(max(horas_espera) FILTER (WHERE ((status_exame)::text <> ALL (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text]))), 1) AS max_horas_espera,
    min(dt_pedido) AS primeiro_pedido,
    max(dt_carga) AS dt_carga
   FROM public.painel22_exames_ps
  GROUP BY nr_atendimento, dt_entrada, nm_pessoa_fisica, idade, ds_convenio
  ORDER BY (count(*) FILTER (WHERE ((status_exame)::text = ANY (ARRAY[('AGUARDANDO'::character varying)::text, ('SOLICITADO'::character varying)::text])))) DESC, dt_entrada;


--
-- Name: vw_painel24_detalhe; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel24_detalhe AS
 SELECT id,
    mes_estoque,
    cd_local_estoque,
    local_estoque,
    grupo,
    subgrupo,
    codigo_material,
    item,
    consumo_dia,
    saldo_disponivel,
    dias_estoque,
    cd_local_origem,
    local_origem_sugerido,
    saldo_origem,
    dias_estoque_origem,
    dt_carga,
        CASE
            WHEN ((upper((local_estoque)::text) ~~ '%CAF%'::text) OR (upper((local_estoque)::text) ~~ '%CENTRAL DE ABASTECIMENTO%'::text)) THEN 'CAF'::text
            WHEN ((upper((local_estoque)::text) ~~ 'FARMÁCIA%'::text) OR (upper((local_estoque)::text) ~~ 'FARMACIA%'::text)) THEN 'FARMACIA'::text
            WHEN (upper((local_estoque)::text) ~~ 'CARRINHO%'::text) THEN 'CARRINHO'::text
            WHEN (upper((local_estoque)::text) ~~ 'MALETA%'::text) THEN 'MALETA'::text
            ELSE 'OUTRO'::text
        END AS tipo_local,
        CASE
            WHEN ((consumo_dia = (0)::numeric) OR (consumo_dia IS NULL)) THEN 'SEM CONSUMO'::text
            WHEN (dias_estoque < (0)::numeric) THEN 'DEVEDOR'::text
            WHEN (dias_estoque = (0)::numeric) THEN 'ZERADO'::text
            WHEN (dias_estoque < 0.5) THEN 'CRITICO'::text
            WHEN (dias_estoque < (1)::numeric) THEN 'URGENTE'::text
            WHEN (dias_estoque < (3)::numeric) THEN 'ATENCAO'::text
            WHEN (dias_estoque < (7)::numeric) THEN 'ADEQUADO'::text
            WHEN (dias_estoque < (15)::numeric) THEN 'CONFORTAVEL'::text
            ELSE 'EXCESSO'::text
        END AS classificacao,
        CASE
            WHEN ((consumo_dia = (0)::numeric) OR (consumo_dia IS NULL)) THEN 9
            WHEN (dias_estoque < (0)::numeric) THEN 1
            WHEN (dias_estoque = (0)::numeric) THEN 2
            WHEN (dias_estoque < 0.5) THEN 3
            WHEN (dias_estoque < (1)::numeric) THEN 4
            WHEN (dias_estoque < (3)::numeric) THEN 5
            WHEN (dias_estoque < (7)::numeric) THEN 6
            WHEN (dias_estoque < (15)::numeric) THEN 7
            ELSE 8
        END AS ordem_classificacao,
        CASE
            WHEN ((consumo_dia > (0)::numeric) AND (dias_estoque < (3)::numeric)) THEN round(((consumo_dia * (3)::numeric) - GREATEST(saldo_disponivel, (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS qt_ressuprimento_3d,
        CASE
            WHEN ((local_origem_sugerido IS NOT NULL) AND ((local_origem_sugerido)::text <> ''::text)) THEN true
            ELSE false
        END AS tem_origem
   FROM public.painel24_estoque_dia p;


--
-- Name: vw_painel24_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel24_dashboard AS
 SELECT (count(*))::integer AS total_itens,
    (count(DISTINCT codigo_material))::integer AS total_materiais,
    (count(DISTINCT cd_local_estoque))::integer AS total_locais,
    (count(*) FILTER (WHERE (classificacao = 'DEVEDOR'::text)))::integer AS qt_devedor,
    (count(*) FILTER (WHERE (classificacao = 'ZERADO'::text)))::integer AS qt_zerado,
    (count(*) FILTER (WHERE (classificacao = 'CRITICO'::text)))::integer AS qt_critico,
    (count(*) FILTER (WHERE (classificacao = 'URGENTE'::text)))::integer AS qt_urgente,
    (count(*) FILTER (WHERE (classificacao = 'ATENCAO'::text)))::integer AS qt_atencao,
    (count(*) FILTER (WHERE (classificacao = 'ADEQUADO'::text)))::integer AS qt_adequado,
    (count(*) FILTER (WHERE (classificacao = 'CONFORTAVEL'::text)))::integer AS qt_confortavel,
    (count(*) FILTER (WHERE (classificacao = 'EXCESSO'::text)))::integer AS qt_excesso,
    (count(*) FILTER (WHERE (classificacao = 'SEM CONSUMO'::text)))::integer AS qt_sem_consumo,
    (count(*) FILTER (WHERE (classificacao = ANY (ARRAY['DEVEDOR'::text, 'ZERADO'::text, 'CRITICO'::text, 'URGENTE'::text, 'ATENCAO'::text]))))::integer AS qt_abaixo_3d,
    (count(*) FILTER (WHERE (saldo_disponivel < (0)::numeric)))::integer AS qt_saldo_negativo,
    (count(*) FILTER (WHERE (tem_origem = true)))::integer AS qt_com_origem,
    (count(*) FILTER (WHERE ((classificacao = ANY (ARRAY['DEVEDOR'::text, 'ZERADO'::text, 'CRITICO'::text, 'URGENTE'::text, 'ATENCAO'::text])) AND (tem_origem = false))))::integer AS qt_sem_origem_critico,
    COALESCE(sum(qt_ressuprimento_3d) FILTER (WHERE (qt_ressuprimento_3d > (0)::numeric)), (0)::numeric) AS qt_total_ressuprimento,
    (count(DISTINCT cd_local_estoque) FILTER (WHERE (classificacao = ANY (ARRAY['DEVEDOR'::text, 'ZERADO'::text, 'CRITICO'::text, 'URGENTE'::text]))))::integer AS qt_locais_criticos,
    max(dt_carga) AS ultima_atualizacao
   FROM public.vw_painel24_detalhe;


--
-- Name: vw_painel25_exames_detalhe; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel25_exames_detalhe AS
 SELECT id,
    nr_atendimento,
    dt_entrada,
    tempo_no_ps,
    nm_pessoa_fisica,
    idade,
    ie_sexo,
    ds_convenio,
    cd_medico_resp,
    nm_medico_resp,
    ds_clinica,
    cd_cid_principal,
    nr_seq_classificacao,
    tipo_exame,
    ds_procedimento,
    ds_material,
    dt_pedido,
    dt_coleta_execucao,
    dt_resultado,
    status_exame,
    ds_status,
    tempo_espera,
    prioridade_ordem,
    dt_carga
   FROM public.painel25_ps_exames_medico
  ORDER BY nr_atendimento, prioridade_ordem, dt_pedido;


--
-- Name: vw_painel25_resumo_paciente; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel25_resumo_paciente AS
 SELECT nr_atendimento,
    nm_pessoa_fisica,
    idade,
    ie_sexo,
    ds_convenio,
    cd_medico_resp,
    nm_medico_resp,
    ds_clinica,
    cd_cid_principal,
    nr_seq_classificacao,
    tempo_no_ps,
    dt_entrada,
    count(*) AS qt_exames_total,
    sum(
        CASE
            WHEN ((tipo_exame)::text = 'RADIOLOGIA'::text) THEN 1
            ELSE 0
        END) AS qt_radio,
    sum(
        CASE
            WHEN ((tipo_exame)::text = 'LABORATORIO'::text) THEN 1
            ELSE 0
        END) AS qt_lab,
    sum(
        CASE
            WHEN ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text])) THEN 1
            ELSE 0
        END) AS qt_prontos,
    sum(
        CASE
            WHEN ((status_exame)::text = ANY (ARRAY[('AGUARDANDO'::character varying)::text, ('SOLICITADO'::character varying)::text])) THEN 1
            ELSE 0
        END) AS qt_pendentes,
    sum(
        CASE
            WHEN ((status_exame)::text = ANY (ARRAY[('EXECUTADO'::character varying)::text, ('COLETADO'::character varying)::text, ('EM_ANALISE'::character varying)::text, ('RESULTADO_PARCIAL'::character varying)::text])) THEN 1
            ELSE 0
        END) AS qt_em_andamento,
        CASE
            WHEN (count(*) = sum(
            CASE
                WHEN ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text])) THEN 1
                ELSE 0
            END)) THEN 'TODOS_PRONTOS'::text
            WHEN (sum(
            CASE
                WHEN ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text])) THEN 1
                ELSE 0
            END) > 0) THEN 'PARCIAL'::text
            ELSE 'NENHUM_PRONTO'::text
        END AS situacao_geral
   FROM public.painel25_ps_exames_medico
  GROUP BY nr_atendimento, nm_pessoa_fisica, idade, ie_sexo, ds_convenio, cd_medico_resp, nm_medico_resp, ds_clinica, cd_cid_principal, nr_seq_classificacao, tempo_no_ps, dt_entrada
  ORDER BY
        CASE
            WHEN (count(*) = sum(
            CASE
                WHEN ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text])) THEN 1
                ELSE 0
            END)) THEN 1
            WHEN (sum(
            CASE
                WHEN ((status_exame)::text = ANY (ARRAY[('LAUDADO'::character varying)::text, ('LIBERADO'::character varying)::text])) THEN 1
                ELSE 0
            END) > 0) THEN 2
            ELSE 3
        END, dt_entrada;


--
-- Name: vw_painel33_autorizacoes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel33_autorizacoes AS
 WITH itens_agregados AS (
         SELECT a_1.nr_sequencia,
            COALESCE(m.qt_mat, (0)::bigint) AS qt_materiais,
            COALESCE(p.qt_proc, (0)::bigint) AS qt_procedimentos,
            COALESCE(d.qt_doc, (0)::bigint) AS qt_documentos,
            (COALESCE(m.qt_sol, (0)::numeric) + COALESCE(p.qt_sol, (0)::numeric)) AS qt_itens_solicitados,
            (COALESCE(m.qt_aut, (0)::numeric) + COALESCE(p.qt_aut, (0)::numeric)) AS qt_itens_autorizados,
            COALESCE(m.vl_tot, (0)::numeric) AS vl_total_materiais,
            d.tem_protocolo_operadora
           FROM (((public.painel33_autorizacoes_convenio a_1
             LEFT JOIN ( SELECT painel33_autorizacao_materiais.nr_sequencia_autor,
                    count(*) AS qt_mat,
                    sum(COALESCE(painel33_autorizacao_materiais.qt_solicitada, (0)::numeric)) AS qt_sol,
                    sum(COALESCE(painel33_autorizacao_materiais.qt_autorizada, (0)::numeric)) AS qt_aut,
                    sum(COALESCE(painel33_autorizacao_materiais.vl_total, (0)::numeric)) AS vl_tot
                   FROM public.painel33_autorizacao_materiais
                  GROUP BY painel33_autorizacao_materiais.nr_sequencia_autor) m ON ((m.nr_sequencia_autor = a_1.nr_sequencia)))
             LEFT JOIN ( SELECT painel33_autorizacao_procedimentos.nr_sequencia_autor,
                    count(*) AS qt_proc,
                    sum(COALESCE(painel33_autorizacao_procedimentos.qt_solicitada, (0)::numeric)) AS qt_sol,
                    sum(COALESCE(painel33_autorizacao_procedimentos.qt_autorizada, (0)::numeric)) AS qt_aut
                   FROM public.painel33_autorizacao_procedimentos
                  GROUP BY painel33_autorizacao_procedimentos.nr_sequencia_autor) p ON ((p.nr_sequencia_autor = a_1.nr_sequencia)))
             LEFT JOIN ( SELECT painel33_autorizacao_documentos.nr_sequencia_autor,
                    count(*) AS qt_doc,
                    bool_or((COALESCE(NULLIF((painel33_autorizacao_documentos.nr_protoc_rec_operadora)::text, ''::text), NULL::text) IS NOT NULL)) AS tem_protocolo_operadora
                   FROM public.painel33_autorizacao_documentos
                  GROUP BY painel33_autorizacao_documentos.nr_sequencia_autor) d ON ((d.nr_sequencia_autor = a_1.nr_sequencia)))
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
    (ia.qt_materiais > 0) AS tem_material,
    (ia.qt_procedimentos > 0) AS tem_procedimento,
    (ia.qt_documentos > 0) AS tem_documento,
    ((ia.qt_materiais + ia.qt_procedimentos) > 0) AS tem_item,
    COALESCE(ia.tem_protocolo_operadora, false) AS tem_protocolo_operadora,
        CASE
            WHEN ((a.dt_pedido_medico IS NOT NULL) AND (a.dt_envio IS NOT NULL)) THEN (EXTRACT(epoch FROM (a.dt_envio - a.dt_pedido_medico)) / 86400.0)
            ELSE NULL::numeric
        END AS dias_pedido_envio,
        CASE
            WHEN ((a.dt_envio IS NOT NULL) AND (a.dt_retorno IS NOT NULL)) THEN (EXTRACT(epoch FROM (a.dt_retorno - a.dt_envio)) / 86400.0)
            ELSE NULL::numeric
        END AS dias_envio_retorno,
        CASE
            WHEN ((a.dt_pedido_medico IS NOT NULL) AND (a.dt_autorizacao IS NOT NULL)) THEN (EXTRACT(epoch FROM (a.dt_autorizacao - a.dt_pedido_medico)) / 86400.0)
            ELSE NULL::numeric
        END AS dias_total_sla,
        CASE
            WHEN ((a.ds_estagio)::text <> ALL (ARRAY[('Autorizado'::character varying)::text, ('Cancelado'::character varying)::text, ('Negado'::character varying)::text, ('Carência Contratual'::character varying)::text])) THEN (EXTRACT(epoch FROM (now() - (COALESCE(a.dt_pedido_medico, a.dt_autorizacao))::timestamp with time zone)) / 3600.0)
            ELSE NULL::numeric
        END AS horas_em_aberto,
        CASE
            WHEN ((a.dt_inicio_vigencia IS NULL) OR (a.dt_fim_vigencia IS NULL)) THEN 'sem_vigencia'::text
            WHEN (CURRENT_DATE < (a.dt_inicio_vigencia)::date) THEN 'a_iniciar'::text
            WHEN (CURRENT_DATE > (a.dt_fim_vigencia)::date) THEN 'vencida'::text
            ELSE 'vigente'::text
        END AS status_vigencia,
        CASE
            WHEN ((a.dt_fim_vigencia IS NOT NULL) AND ((a.dt_fim_vigencia)::date >= CURRENT_DATE) AND ((a.dt_fim_vigencia)::date <= (CURRENT_DATE + '2 days'::interval))) THEN true
            ELSE false
        END AS vigencia_proxima_fim,
    COALESCE(sla.qt_dias_prazo, 7) AS qt_dias_prazo_convenio,
        CASE
            WHEN (((a.ds_estagio)::text = 'Autorizado'::text) AND (a.dt_pedido_medico IS NOT NULL) AND (a.dt_autorizacao IS NOT NULL)) THEN
            CASE
                WHEN ((EXTRACT(epoch FROM (a.dt_autorizacao - a.dt_pedido_medico)) / 86400.0) <= (COALESCE(sla.qt_dias_prazo, 7))::numeric) THEN 'dentro'::text
                ELSE 'atrasado'::text
            END
            WHEN ((a.ds_estagio)::text <> ALL (ARRAY[('Autorizado'::character varying)::text, ('Cancelado'::character varying)::text, ('Negado'::character varying)::text, ('Carência Contratual'::character varying)::text])) THEN
            CASE
                WHEN (a.dt_pedido_medico IS NULL) THEN 'sem_pedido'::text
                WHEN ((EXTRACT(epoch FROM (now() - (a.dt_pedido_medico)::timestamp with time zone)) / 86400.0) > (COALESCE(sla.qt_dias_prazo, 7))::numeric) THEN 'atrasado'::text
                WHEN ((EXTRACT(epoch FROM (now() - (a.dt_pedido_medico)::timestamp with time zone)) / 86400.0) > ((COALESCE(sla.qt_dias_prazo, 7))::numeric * 0.7)) THEN 'atencao'::text
                ELSE 'dentro'::text
            END
            ELSE NULL::text
        END AS status_sla,
        CASE
            WHEN ((a.ds_estagio)::text = 'Autorizado'::text) THEN 'Autorizado'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Cancelado'::character varying)::text, ('Negado'::character varying)::text, ('Carência Contratual'::character varying)::text])) THEN 'negado'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Pendência pedido (Operadora)'::character varying)::text])) THEN 'acao_hospital'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Inconsistência na Solicitação'::character varying)::text])) THEN 'Inconsistência na Solicitação'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Aguard. Justificativa'::character varying)::text])) THEN 'Aguard. Justificativa'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Autoriz. Pendente'::character varying)::text])) THEN 'Autoriz. Pendente'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Solicitado OVERMIND'::character varying)::text])) THEN 'Solicitado OVERMIND'::text
            ELSE 'outros'::text
        END AS grupo_estagio,
        CASE
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Negado'::character varying)::text, ('Cancelado'::character varying)::text, ('Carência Contratual'::character varying)::text])) THEN 'vermelho'::text
            WHEN ((a.dt_fim_vigencia IS NOT NULL) AND (CURRENT_DATE > (a.dt_fim_vigencia)::date) AND ((a.ds_estagio)::text <> ALL (ARRAY[('Cancelado'::character varying)::text, ('Negado'::character varying)::text]))) THEN 'vermelho'::text
            WHEN (((a.ds_estagio)::text <> ALL (ARRAY[('Autorizado'::character varying)::text, ('Cancelado'::character varying)::text, ('Negado'::character varying)::text, ('Carência Contratual'::character varying)::text])) AND (a.dt_pedido_medico IS NOT NULL) AND ((EXTRACT(epoch FROM (now() - (a.dt_pedido_medico)::timestamp with time zone)) / 86400.0) > (COALESCE(sla.qt_dias_prazo, 7))::numeric)) THEN 'vermelho'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Aguard. Justificativa'::character varying)::text, ('Pendência pedido (Operadora)'::character varying)::text, ('Inconsistência na Solicitação'::character varying)::text])) THEN 'laranja'::text
            WHEN ((a.ds_estagio)::text = ANY (ARRAY[('Autoriz. Pendente'::character varying)::text, ('Solicitado'::character varying)::text, ('Solicitado OVERMIND'::character varying)::text])) THEN 'amarelo'::text
            WHEN ((a.ds_estagio)::text = 'Autorizado'::text) THEN 'verde'::text
            ELSE 'amarelo'::text
        END AS status_semaforo
   FROM ((public.painel33_autorizacoes_convenio a
     LEFT JOIN itens_agregados ia ON ((ia.nr_sequencia = a.nr_sequencia)))
     LEFT JOIN public.painel33_convenio_sla sla ON (((sla.cd_convenio = a.cd_convenio) AND (sla.ie_ativo = 'S'::bpchar))));


--
-- Name: vw_painel33_valores_por_autorizacao; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel33_valores_por_autorizacao AS
 WITH autorizacoes_periodo AS (
         SELECT a.nr_sequencia,
            a.nr_atendimento,
            a.dt_autorizacao,
            a.ds_estagio
           FROM public.painel33_autorizacoes_convenio a
          WHERE (a.dt_autorizacao >= (CURRENT_DATE - '90 days'::interval))
        ), conta_da_autorizacao AS (
         SELECT ap_1.nr_sequencia AS nr_sequencia_autorizacao,
            ap_1.nr_atendimento,
            ap_1.ds_estagio,
            c.nr_interno_conta,
            c.dt_periodo_inicial AS dt_conta_inicial,
            c.dt_periodo_final AS dt_conta_final,
            c.vl_conta AS vl_total_conta,
            c.ie_status_acerto AS status_conta,
            c.nr_seq_protocolo AS protocolo_conta,
            row_number() OVER (PARTITION BY ap_1.nr_sequencia ORDER BY c.dt_periodo_inicial DESC) AS rn
           FROM (autorizacoes_periodo ap_1
             LEFT JOIN public.painel33_contas_paciente c ON (((c.nr_atendimento = ap_1.nr_atendimento) AND ((ap_1.dt_autorizacao >= c.dt_periodo_inicial) AND (ap_1.dt_autorizacao <= COALESCE(c.dt_periodo_final, (c.dt_periodo_inicial + '90 days'::interval)))) AND (COALESCE(c.ie_cancelamento, 'N'::bpchar) <> 'S'::bpchar))))
        ), conta_principal AS (
         SELECT conta_da_autorizacao.nr_sequencia_autorizacao,
            conta_da_autorizacao.nr_atendimento,
            conta_da_autorizacao.ds_estagio,
            conta_da_autorizacao.nr_interno_conta,
            conta_da_autorizacao.dt_conta_inicial,
            conta_da_autorizacao.dt_conta_final,
            conta_da_autorizacao.vl_total_conta,
            conta_da_autorizacao.status_conta,
            conta_da_autorizacao.protocolo_conta,
            conta_da_autorizacao.rn
           FROM conta_da_autorizacao
          WHERE (conta_da_autorizacao.rn = 1)
        ), totais_materiais_por_conta AS (
         SELECT mc.nr_interno_conta,
            sum(COALESCE(mc.vl_material, (0)::numeric)) AS vl_total_materiais_conta,
            count(*) AS qt_materiais_conta
           FROM public.painel33_materiais_conta mc
          WHERE (mc.nr_interno_conta IN ( SELECT conta_principal.nr_interno_conta
                   FROM conta_principal
                  WHERE (conta_principal.nr_interno_conta IS NOT NULL)))
          GROUP BY mc.nr_interno_conta
        ), totais_procedimentos_por_conta AS (
         SELECT pc.nr_interno_conta,
            sum(COALESCE(pc.vl_total_proc, pc.vl_procedimento, (0)::numeric)) AS vl_total_procedimentos_conta,
            count(*) AS qt_procedimentos_conta
           FROM public.painel33_procedimentos_conta pc
          WHERE (pc.nr_interno_conta IN ( SELECT conta_principal.nr_interno_conta
                   FROM conta_principal
                  WHERE (conta_principal.nr_interno_conta IS NOT NULL)))
          GROUP BY pc.nr_interno_conta
        ), match_direto_materiais AS (
         SELECT pam.nr_sequencia_autor AS nr_sequencia_autorizacao,
            count(*) AS qt_itens_match_direto,
            sum(COALESCE(mc.vl_material, (0)::numeric)) AS vl_match_direto
           FROM (public.painel33_autorizacao_materiais pam
             JOIN public.painel33_materiais_conta mc ON ((mc.nr_seq_mat_autor = pam.nr_sequencia)))
          WHERE (pam.nr_sequencia_autor IN ( SELECT autorizacoes_periodo.nr_sequencia
                   FROM autorizacoes_periodo))
          GROUP BY pam.nr_sequencia_autor
        ), match_direto_procedimentos AS (
         SELECT pap.nr_sequencia_autor AS nr_sequencia_autorizacao,
            count(*) AS qt_itens_match_direto,
            sum(COALESCE(pc.vl_total_proc, pc.vl_procedimento, (0)::numeric)) AS vl_match_direto
           FROM (public.painel33_autorizacao_procedimentos pap
             JOIN public.painel33_procedimentos_conta pc ON ((pc.nr_seq_proc_autor = pap.nr_sequencia)))
          WHERE (pap.nr_sequencia_autor IN ( SELECT autorizacoes_periodo.nr_sequencia
                   FROM autorizacoes_periodo))
          GROUP BY pap.nr_sequencia_autor
        ), match_codigo_materiais AS (
         SELECT cp_1.nr_sequencia_autorizacao,
            count(DISTINCT mc.nr_sequencia) AS qt_itens_match_codigo,
            sum(COALESCE(mc.vl_material, (0)::numeric)) AS vl_match_codigo
           FROM ((conta_principal cp_1
             JOIN public.painel33_autorizacao_materiais pam ON ((pam.nr_sequencia_autor = cp_1.nr_sequencia_autorizacao)))
             JOIN public.painel33_materiais_conta mc ON (((mc.nr_interno_conta = cp_1.nr_interno_conta) AND ((mc.cd_material)::text = (pam.cd_material)::text))))
          GROUP BY cp_1.nr_sequencia_autorizacao
        ), match_codigo_procedimentos AS (
         SELECT cp_1.nr_sequencia_autorizacao,
            count(DISTINCT pc.nr_sequencia) AS qt_itens_match_codigo,
            sum(COALESCE(pc.vl_total_proc, pc.vl_procedimento, (0)::numeric)) AS vl_match_codigo
           FROM ((conta_principal cp_1
             JOIN public.painel33_autorizacao_procedimentos pap ON ((pap.nr_sequencia_autor = cp_1.nr_sequencia_autorizacao)))
             JOIN public.painel33_procedimentos_conta pc ON (((pc.nr_interno_conta = cp_1.nr_interno_conta) AND (pc.cd_procedimento = pap.cd_procedimento) AND (pc.ie_origem_proced = pap.ie_origem_proced))))
          GROUP BY cp_1.nr_sequencia_autorizacao
        )
 SELECT ap.nr_sequencia AS nr_sequencia_autorizacao,
    ap.nr_atendimento,
    ap.ds_estagio,
    cp.nr_interno_conta,
    cp.dt_conta_inicial,
    cp.dt_conta_final,
    cp.vl_total_conta,
    cp.status_conta,
    cp.protocolo_conta,
    COALESCE(mdm.qt_itens_match_direto, (0)::bigint) AS qt_materiais_vinculados,
    COALESCE(mdm.vl_match_direto, (0)::numeric) AS vl_materiais_vinculados,
    COALESCE(mdp.qt_itens_match_direto, (0)::bigint) AS qt_procedimentos_vinculados,
    COALESCE(mdp.vl_match_direto, (0)::numeric) AS vl_procedimentos_vinculados,
    (COALESCE(mdm.vl_match_direto, (0)::numeric) + COALESCE(mdp.vl_match_direto, (0)::numeric)) AS vl_total_vinculado,
    COALESCE(mcm.qt_itens_match_codigo, (0)::bigint) AS qt_materiais_por_codigo,
    COALESCE(mcm.vl_match_codigo, (0)::numeric) AS vl_materiais_por_codigo,
    COALESCE(mcp.qt_itens_match_codigo, (0)::bigint) AS qt_procedimentos_por_codigo,
    COALESCE(mcp.vl_match_codigo, (0)::numeric) AS vl_procedimentos_por_codigo,
    (COALESCE(mcm.vl_match_codigo, (0)::numeric) + COALESCE(mcp.vl_match_codigo, (0)::numeric)) AS vl_total_por_codigo,
    COALESCE(tmc.vl_total_materiais_conta, (0)::numeric) AS vl_total_materiais_conta,
    COALESCE(tpc.vl_total_procedimentos_conta, (0)::numeric) AS vl_total_procedimentos_conta,
    (COALESCE(tmc.vl_total_materiais_conta, (0)::numeric) + COALESCE(tpc.vl_total_procedimentos_conta, (0)::numeric)) AS vl_total_executado_conta,
    COALESCE(tmc.qt_materiais_conta, (0)::bigint) AS qt_materiais_conta,
    COALESCE(tpc.qt_procedimentos_conta, (0)::bigint) AS qt_procedimentos_conta,
        CASE
            WHEN ((ap.ds_estagio)::text = ANY ((ARRAY['Autorizado'::character varying, 'Cancelado'::character varying, 'Negado'::character varying, 'Carência Contratual'::character varying])::text[])) THEN (0)::numeric
            ELSE GREATEST((COALESCE(mdm.vl_match_direto, (0)::numeric) + COALESCE(mdp.vl_match_direto, (0)::numeric)), (COALESCE(mcm.vl_match_codigo, (0)::numeric) + COALESCE(mcp.vl_match_codigo, (0)::numeric)))
        END AS vl_pendente_autorizacao,
        CASE
            WHEN ((ap.ds_estagio)::text = ANY ((ARRAY['Autorizado'::character varying, 'Cancelado'::character varying, 'Negado'::character varying, 'Carência Contratual'::character varying])::text[])) THEN false
            WHEN ((COALESCE(tmc.vl_total_materiais_conta, (0)::numeric) + COALESCE(tpc.vl_total_procedimentos_conta, (0)::numeric)) > (10000)::numeric) THEN true
            ELSE false
        END AS flag_alto_risco
   FROM (((((((autorizacoes_periodo ap
     LEFT JOIN conta_principal cp ON ((cp.nr_sequencia_autorizacao = ap.nr_sequencia)))
     LEFT JOIN match_direto_materiais mdm ON ((mdm.nr_sequencia_autorizacao = ap.nr_sequencia)))
     LEFT JOIN match_direto_procedimentos mdp ON ((mdp.nr_sequencia_autorizacao = ap.nr_sequencia)))
     LEFT JOIN match_codigo_materiais mcm ON ((mcm.nr_sequencia_autorizacao = ap.nr_sequencia)))
     LEFT JOIN match_codigo_procedimentos mcp ON ((mcp.nr_sequencia_autorizacao = ap.nr_sequencia)))
     LEFT JOIN totais_materiais_por_conta tmc ON ((tmc.nr_interno_conta = cp.nr_interno_conta)))
     LEFT JOIN totais_procedimentos_por_conta tpc ON ((tpc.nr_interno_conta = cp.nr_interno_conta)));


--
-- Name: vw_painel9_pendencias_criticas; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel9_pendencias_criticas AS
 SELECT nr_atendimento,
    nm_pessoa_fisica,
    nm_setor,
    cd_unidade,
    qt_dia_permanencia,
    nm_guerra AS medico_responsavel,
    lab_pendentes,
    img_pendentes,
    dt_entrada_unidade
   FROM public.pendencias_lab
  WHERE ((qt_dia_permanencia >= 2) AND (((lab_pendentes IS NOT NULL) AND (lab_pendentes <> ''::text)) OR ((img_pendentes IS NOT NULL) AND (img_pendentes <> ''::text))))
  ORDER BY qt_dia_permanencia DESC, nm_setor;


--
-- Name: vw_painel9_resumo_setor; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel9_resumo_setor AS
 SELECT nm_setor,
    cd_setor_atendimento,
    count(*) AS total_pacientes,
    count(
        CASE
            WHEN ((lab_pendentes IS NOT NULL) AND (lab_pendentes <> ''::text)) THEN 1
            ELSE NULL::integer
        END) AS pacientes_com_lab_pendente,
    count(
        CASE
            WHEN ((img_pendentes IS NOT NULL) AND (img_pendentes <> ''::text)) THEN 1
            ELSE NULL::integer
        END) AS pacientes_com_img_pendente,
    count(
        CASE
            WHEN (((lab_pendentes IS NOT NULL) AND (lab_pendentes <> ''::text)) OR ((img_pendentes IS NOT NULL) AND (img_pendentes <> ''::text))) THEN 1
            ELSE NULL::integer
        END) AS pacientes_com_alguma_pendencia,
    round(avg(qt_dia_permanencia), 1) AS media_dias_internacao
   FROM public.pendencias_lab
  GROUP BY nm_setor, cd_setor_atendimento
  ORDER BY (count(*)) DESC;


--
-- Name: vw_painel_clinico_risco; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_clinico_risco AS
 SELECT p.nr_atendimento,
    p.dt_entrada_unidade,
    p.dt_entrada_unid,
    p.cd_unidade,
    p.cd_unidade_basica,
    p.nm_pessoa_fisica,
    p.cd_setor_atendimento,
    p.nm_setor,
    p.dt_nascimento,
    p.ie_sexo,
    p.ds_convenio,
    p.nr_crm,
    p.nm_guerra,
    p.qt_dia_permanencia,
    p.ds_clinica,
    p.dt_alta_medico,
    p.ds_tipo_acomodacao,
    p.classif,
    p.ie_status_unidade,
    p.qt_pa_sistolica,
    p.qt_pa_diastolica,
    p.qt_pam,
    p.qt_freq_cardiaca,
    p.qt_freq_resp,
    p.qt_temp,
    p.qt_saturacao_o2,
    p.qt_peso,
    p.qt_imc,
    p.qt_glicemia_capilar,
    p.qt_escala_dor,
    p.exm_glicose,
    p.exm_creatinina,
    p.exm_ureia,
    p.exm_sodio,
    p.exm_potassio,
    p.exm_calcio_ionico,
    p.exm_fosforo,
    p.exm_magnesio,
    p.exm_hematocrito,
    p.exm_hemoglobina,
    p.exm_leucocitos,
    p.exm_plaquetas,
    p.exm_bilir_total,
    p.exm_bilir_indireta,
    p.exm_bilir_direta,
    p.exm_ggt,
    p.exm_rni,
    p.exm_troponina,
    p.exm_dimero_d,
    p.exm_lactato_art,
    p.exm_lactato_ven,
    p.exm_ca_art,
    p.exm_ca_ven,
    p.exm_ph_art,
    p.exm_pco2_art,
    p.exm_po2_art,
    p.exm_so2_art,
    p.exm_hco3_art,
    p.exm_be_art,
    p.exm_pao2_art,
    p.exm_fio2_art,
    p.exm_ph_ven,
    p.exm_pco2_ven,
    p.exm_po2_ven,
    p.exm_so2_ven,
    p.exm_hco3_ven,
    p.exm_be_ven,
    p.exm_ag_ven,
    p.exm_pao2_ven,
    p.dt_carga,
    public.calc_score_news2_respiratorio(p.qt_freq_resp, p.qt_saturacao_o2) AS score_news2_respiratorio,
    public.calc_score_news2_cardiovascular(p.qt_pa_sistolica, p.qt_freq_cardiaca) AS score_news2_cardiovascular,
    public.calc_score_news2_temperatura(p.qt_temp) AS score_news2_temperatura,
    public.calc_score_news2_total(p.qt_freq_resp, p.qt_saturacao_o2, p.qt_pa_sistolica, p.qt_freq_cardiaca, p.qt_temp) AS score_news2_total,
    public.classifica_risco_news2(public.calc_score_news2_total(p.qt_freq_resp, p.qt_saturacao_o2, p.qt_pa_sistolica, p.qt_freq_cardiaca, p.qt_temp)) AS classificacao_news2,
    public.calc_score_sofa_renal(p.exm_creatinina) AS score_sofa_renal,
    public.calc_score_eletrolitos(p.exm_sodio, p.exm_potassio) AS score_eletrolitos,
    public.calc_score_inflamatorio(p.exm_leucocitos, p.exm_lactato_art, p.exm_lactato_ven) AS score_inflamatorio,
    public.calc_score_cardiaco(p.exm_troponina, p.exm_dimero_d) AS score_cardiaco,
    public.calc_score_hematologico(p.exm_hemoglobina) AS score_hematologico,
    public.calc_score_laboratorial_total(p.exm_creatinina, p.exm_sodio, p.exm_potassio, p.exm_leucocitos, p.exm_lactato_art, p.exm_lactato_ven, p.exm_troponina, p.exm_dimero_d, p.exm_hemoglobina) AS score_lab_total,
    public.calc_score_clinico_total(p.qt_freq_resp, p.qt_saturacao_o2, p.qt_pa_sistolica, p.qt_freq_cardiaca, p.qt_temp, p.exm_creatinina, p.exm_sodio, p.exm_potassio, p.exm_leucocitos, p.exm_lactato_art, p.exm_lactato_ven, p.exm_troponina, p.exm_dimero_d, p.exm_hemoglobina) AS score_clinico_total,
    public.classifica_risco_total(public.calc_score_clinico_total(p.qt_freq_resp, p.qt_saturacao_o2, p.qt_pa_sistolica, p.qt_freq_cardiaca, p.qt_temp, p.exm_creatinina, p.exm_sodio, p.exm_potassio, p.exm_leucocitos, p.exm_lactato_art, p.exm_lactato_ven, p.exm_troponina, p.exm_dimero_d, p.exm_hemoglobina)) AS nivel_risco_total,
    ia.analise_ia,
    ia.nivel_criticidade AS ia_criticidade,
    ia.score_ia,
    ia.dt_analise AS ia_dt_analise,
    ia.dt_atualizacao AS ia_dt_atualizacao,
    concat('🫀 VITAIS: ', 'PA=', COALESCE((p.qt_pa_sistolica)::text, 'NA'::text), '/', COALESCE((p.qt_pa_diastolica)::text, 'NA'::text), ' mmHg | ', 'FC=', COALESCE((p.qt_freq_cardiaca)::text, 'NA'::text), ' bpm | ', 'FR=', COALESCE((p.qt_freq_resp)::text, 'NA'::text), ' irpm | ', 'SpO2=', COALESCE((p.qt_saturacao_o2)::text, 'NA'::text), '% | ', 'T=', COALESCE((p.qt_temp)::text, 'NA'::text), '°C', ' 🧪 LABS: ', 'Cr=', COALESCE(p.exm_creatinina, 'NA'::text), ' mg/dL | ', 'Na=', COALESCE(p.exm_sodio, 'NA'::text), ' mEq/L | ', 'K=', COALESCE(p.exm_potassio, 'NA'::text), ' mEq/L | ', 'Leuco=', COALESCE(p.exm_leucocitos, 'NA'::text), ' mil/mm³ | ', 'Hb=', COALESCE(p.exm_hemoglobina, 'NA'::text), ' g/dL | ', 'Lactato=', COALESCE(COALESCE(p.exm_lactato_art, p.exm_lactato_ven), 'NA'::text), ' mmol/L',
        CASE
            WHEN ((p.exm_troponina IS NOT NULL) AND (p.exm_troponina <> 'NA'::text)) THEN ((' | 💔 Trop='::text || p.exm_troponina) || ' ng/mL'::text)
            ELSE ''::text
        END,
        CASE
            WHEN ((p.exm_dimero_d IS NOT NULL) AND (p.exm_dimero_d <> 'NA'::text)) THEN ((' | 🩸 D-D='::text || p.exm_dimero_d) || ' ng/mL'::text)
            ELSE ''::text
        END) AS resumo_clinico_completo
   FROM (public.painel_clinico_tasy p
     LEFT JOIN public.painel_clinico_analise_ia ia ON ((p.nr_atendimento = ia.nr_atendimento)))
  WHERE ((p.ie_status_unidade)::text = 'P'::text);


--
-- Name: vw_painel_enfermaria_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_enfermaria_stats AS
 SELECT nm_setor,
    cd_setor_atendimento,
    count(*) AS total_leitos,
    count(nr_atendimento) AS leitos_ocupados,
    (count(*) - count(nr_atendimento)) AS leitos_livres,
    round((((count(nr_atendimento))::numeric / (count(*))::numeric) * (100)::numeric), 1) AS percentual_ocupacao,
    sum(
        CASE
            WHEN (score_news >= 5) THEN 1
            ELSE 0
        END) AS pacientes_criticos,
    sum(
        CASE
            WHEN ((parecer_pendente)::text = 'Sim'::text) THEN 1
            ELSE 0
        END) AS pareceres_pendentes,
    max(dt_atualizacao) AS ultima_atualizacao
   FROM public.painel_enfermaria
  GROUP BY nm_setor, cd_setor_atendimento
  ORDER BY nm_setor;


--
-- Name: vw_painel_nutricao; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_nutricao AS
 SELECT nr_atendimento,
    nm_paciente,
    leito,
    dt_entrada,
    setor,
    nm_medico,
    convenio,
    idade,
    nr_prescricao,
    dt_prescricao,
    prescritor,
    nm_prescritor,
    regexp_replace(regexp_replace(dieta, '<b>|</b>'::text, ''::text, 'g'::text), 'Dados Prescrição: '::text, ''::text, 'g'::text) AS dieta_limpa,
    regexp_replace(regexp_replace(ds_observacao, '<b>|</b>'::text, ''::text, 'g'::text), 'Obs. Prescrição: '::text, ''::text, 'g'::text) AS obs_limpa,
    "substring"(dieta, 'Dados Prescrição:</b> ([0-9]+)'::text) AS nr_prescricao_texto,
        CASE
            WHEN ((prescritor)::text ~~ '%Nutricionista%'::text) THEN 'Nutricionista'::text
            WHEN ((prescritor)::text ~~ '%Médico%'::text) THEN 'Médico'::text
            ELSE 'Outro'::text
        END AS tipo_prescritor,
    alergia,
        CASE
            WHEN (acompanhante IS NOT NULL) THEN acompanhante
            WHEN ((alergia)::text = 'Sim'::text) THEN 'Sim'::character varying
            WHEN (
            CASE
                WHEN ((idade)::text ~ '^[0-9]+ anos?$'::text) THEN (regexp_replace((idade)::text, '[^0-9]'::text, ''::text, 'g'::text))::integer
                ELSE NULL::integer
            END < 18) THEN 'Sim'::character varying
            WHEN (
            CASE
                WHEN ((idade)::text ~ '^[0-9]+ anos?$'::text) THEN (regexp_replace((idade)::text, '[^0-9]'::text, ''::text, 'g'::text))::integer
                ELSE NULL::integer
            END > 60) THEN 'Sim'::character varying
            ELSE 'Não'::character varying
        END AS acompanhante_calculado,
    dt_atualizacao
   FROM public.painel_prescricoes_nutricao p
  WHERE (setor IS NOT NULL)
  ORDER BY setor, leito;


--
-- Name: vw_painel_ps_alta_internacao; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_ps_alta_internacao AS
 SELECT cd_pessoa_fisica,
    nr_atendimento,
    nm_pessoa_fisica,
    dt_nascimento,
    ds_idade,
    qt_idade,
    dt_entrada,
    hr_inicio_consulta,
    dt_inicio_atendimento,
    hr_fim_consulta,
    hr_reavaliacao_medica,
    dt_fim_reavaliacao,
    dt_atend_medico,
    dt_fim_triagem,
    dt_alta,
    dt_lib_medico,
    dt_medicacao,
    hr_espera,
    cd_medico_resp,
    nm_guerra,
    ds_clinica,
    ds_convenio,
    ds_plano,
    ie_desfecho,
    cd_motivo_alta,
    ds_senha_qmatic,
    ds_senha_gerenciamento,
    ie_status_pa,
    ds_fila,
    ds_necessidade_vaga,
    qt_tempo_local_pa,
    atendimento_internado AS nr_atendimento_internado,
    dt_internacao,
    cd_status_gv,
    ds_status_gv,
    status_internacao,
    tempo_aguardando_vaga,
    dt_carga,
        CASE
            WHEN (((status_internacao)::text <> ALL (ARRAY[('INTERNADO'::character varying)::text, ('ACOMODADO'::character varying)::text, ('TRANSFERIDO'::character varying)::text, ('CANCELADO_NEGADO'::character varying)::text])) AND (dt_alta IS NOT NULL) AND ((dt_alta)::text <> ''::text)) THEN round((EXTRACT(epoch FROM (now() - ((dt_alta)::timestamp without time zone)::timestamp with time zone)) / (60)::numeric))
            ELSE (0)::numeric
        END AS minutos_aguardando
   FROM public.painel_ps_alta_internacao;


--
-- Name: vw_painel_ps_alta_internacao_resumo; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_ps_alta_internacao_resumo AS
 SELECT status_internacao,
    cd_status_gv,
    ds_status_gv,
    ds_clinica,
    nm_guerra,
    ds_convenio,
    count(*) AS qt_pacientes,
    round(avg(
        CASE
            WHEN (((status_internacao)::text <> ALL (ARRAY[('INTERNADO'::character varying)::text, ('ACOMODADO'::character varying)::text, ('TRANSFERIDO'::character varying)::text, ('CANCELADO_NEGADO'::character varying)::text])) AND (dt_alta IS NOT NULL) AND ((dt_alta)::text <> ''::text)) THEN (EXTRACT(epoch FROM (now() - ((dt_alta)::timestamp without time zone)::timestamp with time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END)) AS media_minutos_aguardando
   FROM public.painel_ps_alta_internacao
  GROUP BY status_internacao, cd_status_gv, ds_status_gv, ds_clinica, nm_guerra, ds_convenio
  ORDER BY
        CASE status_internacao
            WHEN 'AGUARDANDO_VAGA'::text THEN 1
            WHEN 'CHAMADO'::text THEN 2
            WHEN 'VAGA_APROVADA'::text THEN 3
            WHEN 'ACOMODADO'::text THEN 4
            WHEN 'INTERNADO'::text THEN 5
            WHEN 'TRANSFERIDO'::text THEN 6
            WHEN 'CANCELADO_NEGADO'::text THEN 7
            ELSE 8
        END;


--
-- Name: vw_painel_sepse; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_painel_sepse AS
 SELECT nr_atendimento,
    nm_pessoa_fisica AS nome_paciente,
    dt_nascimento,
    ie_sexo AS sexo,
    cd_unidade AS leito,
    cd_unidade_basica AS unidade_basica,
    cd_setor_atendimento,
    nm_setor AS setor,
    ds_tipo_acomodacao AS tipo_acomodacao,
    classif AS classificacao,
    nr_crm,
    nm_guerra AS medico_responsavel,
    ds_clinica AS especialidade,
    dt_entrada_unidade,
    dt_entrada_unid AS dt_entrada_formatada,
    qt_dia_permanencia AS dias_internacao,
    ds_convenio,
    qt_pa_sistolica AS pressao_sistolica,
    qt_pa_diastolica AS pressao_diastolica,
    qt_pam AS pressao_arterial_media,
    qt_freq_cardiaca AS frequencia_cardiaca,
    qt_freq_resp AS frequencia_respiratoria,
    qt_temp AS temperatura,
    qt_saturacao_o2 AS saturacao_o2,
    qt_peso AS peso,
    qt_imc AS imc,
    qt_glicemia_capilar AS glicemia_capilar,
    qt_escala_dor AS escala_dor,
    exm_leucocitos AS leucocitos,
    exm_plaquetas AS plaquetas,
    exm_hemoglobina AS hemoglobina,
    exm_hematocrito AS hematocrito,
    exm_creatinina AS creatinina,
    exm_ureia AS ureia,
    exm_sodio AS sodio,
    exm_potassio AS potassio,
    exm_bilir_total AS bilirrubina_total,
    exm_bilir_direta AS bilirrubina_direta,
    exm_bilir_indireta AS bilirrubina_indireta,
    exm_ggt AS ggt,
    exm_lactato_art AS lactato_arterial,
    exm_lactato_ven AS lactato_venoso,
    exm_ph_art AS ph_arterial,
    exm_pco2_art AS pco2_arterial,
    exm_po2_art AS po2_arterial,
    exm_so2_art AS so2_arterial,
    exm_hco3_art AS hco3_arterial,
    exm_be_art AS be_arterial,
    exm_ph_ven AS ph_venoso,
    exm_pco2_ven AS pco2_venoso,
    exm_po2_ven AS po2_venoso,
    exm_so2_ven AS so2_venoso,
    exm_hco3_ven AS hco3_venoso,
    exm_be_ven AS be_venoso,
    exm_rni AS rni,
    exm_troponina AS troponina,
    exm_dimero_d AS dimero_d,
    exm_glicose AS glicose,
    exm_calcio_ionico AS calcio_ionico,
    exm_fosforo AS fosforo,
    exm_magnesio AS magnesio,
        CASE
            WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN true
            ELSE false
        END AS criterio_hipotensao,
        CASE
            WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN true
            ELSE false
        END AS criterio_dessaturacao,
        CASE
            WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN true
            ELSE false
        END AS criterio_temperatura,
        CASE
            WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN true
            ELSE false
        END AS criterio_leucocitos,
        CASE
            WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN true
            ELSE false
        END AS criterio_taquicardia,
        CASE
            WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN true
            ELSE false
        END AS criterio_taquipneia,
        CASE
            WHEN ((exm_plaquetas IS NOT NULL) AND ((replace(exm_plaquetas, ','::text, '.'::text))::numeric < (100000)::numeric)) THEN true
            ELSE false
        END AS criterio_plaquetopenia,
        CASE
            WHEN ((exm_creatinina IS NOT NULL) AND ((replace(exm_creatinina, ','::text, '.'::text))::numeric > (2)::numeric)) THEN true
            ELSE false
        END AS criterio_disfuncao_renal,
        CASE
            WHEN (((exm_lactato_art IS NOT NULL) AND ((replace(exm_lactato_art, ','::text, '.'::text))::numeric > (2)::numeric)) OR ((exm_lactato_ven IS NOT NULL) AND ((replace(exm_lactato_ven, ','::text, '.'::text))::numeric > (2)::numeric))) THEN true
            ELSE false
        END AS criterio_hiperlactatemia,
        CASE
            WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric >= (22)::numeric)) THEN true
            ELSE false
        END AS criterio_qsofa_fr,
        CASE
            WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric <= (100)::numeric)) THEN true
            ELSE false
        END AS criterio_qsofa_pas,
    (((((
        CASE
            WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
            ELSE 0
        END +
        CASE
            WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
            ELSE 0
        END) AS total_criterios_principais,
    ((
        CASE
            WHEN ((exm_plaquetas IS NOT NULL) AND ((replace(exm_plaquetas, ','::text, '.'::text))::numeric < (100000)::numeric)) THEN 1
            ELSE 0
        END +
        CASE
            WHEN ((exm_creatinina IS NOT NULL) AND ((replace(exm_creatinina, ','::text, '.'::text))::numeric > (2)::numeric)) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (((exm_lactato_art IS NOT NULL) AND ((replace(exm_lactato_art, ','::text, '.'::text))::numeric > (2)::numeric)) OR ((exm_lactato_ven IS NOT NULL) AND ((replace(exm_lactato_ven, ','::text, '.'::text))::numeric > (2)::numeric))) THEN 1
            ELSE 0
        END) AS total_criterios_adicionais,
    ((
        CASE
            WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric >= (22)::numeric)) THEN 1
            ELSE 0
        END +
        CASE
            WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric <= (100)::numeric)) THEN 1
            ELSE 0
        END) + 0) AS qsofa_score,
        CASE
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) >= 4) THEN 'CRITICO'::text
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) = 3) THEN 'ALTO'::text
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) = 2) THEN 'MODERADO'::text
            ELSE 'BAIXO'::text
        END AS nivel_risco_sepse,
    dt_carga AS data_atualizacao,
    ie_status_unidade AS status_unidade
   FROM public.painel_clinico_tasy p
  WHERE (((ie_status_unidade)::text = 'P'::text) AND (dt_entrada_unidade >= (CURRENT_DATE - '30 days'::interval)))
  ORDER BY
        CASE
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) >= 4) THEN 1
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) = 3) THEN 2
            WHEN ((((((
            CASE
                WHEN ((qt_pa_sistolica IS NOT NULL) AND ((replace((qt_pa_sistolica)::text, ','::text, '.'::text))::numeric < (100)::numeric)) THEN 1
                ELSE 0
            END +
            CASE
                WHEN ((qt_saturacao_o2 IS NOT NULL) AND ((replace((qt_saturacao_o2)::text, ','::text, '.'::text))::numeric < (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_temp IS NOT NULL) AND (((replace((qt_temp)::text, ','::text, '.'::text))::numeric > 37.8) OR ((replace((qt_temp)::text, ','::text, '.'::text))::numeric < (35)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((exm_leucocitos IS NOT NULL) AND (((replace(exm_leucocitos, ','::text, '.'::text))::numeric > (12000)::numeric) OR ((replace(exm_leucocitos, ','::text, '.'::text))::numeric < (4000)::numeric))) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_cardiaca IS NOT NULL) AND ((replace((qt_freq_cardiaca)::text, ','::text, '.'::text))::numeric > (90)::numeric)) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((qt_freq_resp IS NOT NULL) AND ((replace((qt_freq_resp)::text, ','::text, '.'::text))::numeric > (20)::numeric)) THEN 1
                ELSE 0
            END) = 2) THEN 3
            ELSE 4
        END, nm_pessoa_fisica;


--
-- Name: vw_ps_aguardando_por_clinica; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_aguardando_por_clinica AS
 SELECT ds_clinica,
    count(*) AS total_aguardando,
    COALESCE(round(avg(
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10)) THEN (EXTRACT(epoch FROM (CURRENT_TIMESTAMP - ((dt_inicio_atendimento)::timestamp without time zone)::timestamp with time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_espera_atual_min,
    COALESCE(round(max(
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10)) THEN (EXTRACT(epoch FROM (CURRENT_TIMESTAMP - ((dt_inicio_atendimento)::timestamp without time zone)::timestamp with time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_max_espera_min
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE) AND ((hr_inicio_consulta IS NULL) OR (TRIM(BOTH FROM hr_inicio_consulta) = ''::text)) AND (ds_clinica IS NOT NULL) AND (TRIM(BOTH FROM ds_clinica) <> ''::text))
  GROUP BY ds_clinica
  ORDER BY (count(*)) DESC;


--
-- Name: vw_ps_analise_converted; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_analise_converted AS
 SELECT nr_atendimento,
    nm_pessoa_fisica,
    ds_plano,
    ds_convenio,
    ds_idade,
    qt_idade,
    cd_medico_resp,
    nm_guerra,
    ds_clinica,
    ds_senha_qmatic,
    ds_senha_gerenciamento,
    ds_fila,
    hr_espera,
    ie_status_pa,
    qt_tempo_local_pa,
    dt_carga,
        CASE
            WHEN ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN
            CASE
                WHEN ((dt_entrada)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_entrada)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_entrada)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_entrada)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_entrada,
        CASE
            WHEN ((dt_nascimento IS NOT NULL) AND (TRIM(BOTH FROM dt_nascimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_nascimento)) > 10)) THEN
            CASE
                WHEN ((dt_nascimento)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_nascimento)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_nascimento)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_nascimento)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_nascimento,
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10)) THEN
            CASE
                WHEN ((dt_inicio_atendimento)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_inicio_atendimento)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_inicio_atendimento)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_inicio_atendimento)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_inicio_atendimento,
        CASE
            WHEN ((hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text) AND (length(TRIM(BOTH FROM hr_inicio_consulta)) > 10)) THEN
            CASE
                WHEN ((hr_inicio_consulta)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((hr_inicio_consulta)::timestamp without time zone)::timestamp with time zone
                WHEN ((hr_inicio_consulta)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((hr_inicio_consulta)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS hr_inicio_consulta,
        CASE
            WHEN ((hr_fim_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_fim_consulta) <> ''::text) AND (length(TRIM(BOTH FROM hr_fim_consulta)) > 10)) THEN
            CASE
                WHEN ((hr_fim_consulta)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((hr_fim_consulta)::timestamp without time zone)::timestamp with time zone
                WHEN ((hr_fim_consulta)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((hr_fim_consulta)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS hr_fim_consulta,
        CASE
            WHEN ((dt_atend_medico IS NOT NULL) AND (TRIM(BOTH FROM dt_atend_medico) <> ''::text) AND (length(TRIM(BOTH FROM dt_atend_medico)) > 10)) THEN
            CASE
                WHEN ((dt_atend_medico)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_atend_medico)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_atend_medico)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_atend_medico)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_atend_medico,
        CASE
            WHEN ((dt_fim_triagem IS NOT NULL) AND (TRIM(BOTH FROM dt_fim_triagem) <> ''::text) AND (length(TRIM(BOTH FROM dt_fim_triagem)) > 10)) THEN
            CASE
                WHEN ((dt_fim_triagem)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_fim_triagem)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_fim_triagem)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_fim_triagem)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_fim_triagem,
        CASE
            WHEN ((hr_reavaliacao_medica IS NOT NULL) AND (TRIM(BOTH FROM hr_reavaliacao_medica) <> ''::text) AND (length(TRIM(BOTH FROM hr_reavaliacao_medica)) > 10)) THEN
            CASE
                WHEN ((hr_reavaliacao_medica)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((hr_reavaliacao_medica)::timestamp without time zone)::timestamp with time zone
                WHEN ((hr_reavaliacao_medica)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((hr_reavaliacao_medica)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS hr_reavaliacao_medica,
        CASE
            WHEN ((dt_fim_reavaliacao IS NOT NULL) AND (TRIM(BOTH FROM dt_fim_reavaliacao) <> ''::text) AND (length(TRIM(BOTH FROM dt_fim_reavaliacao)) > 10)) THEN
            CASE
                WHEN ((dt_fim_reavaliacao)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_fim_reavaliacao)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_fim_reavaliacao)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_fim_reavaliacao)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_fim_reavaliacao,
        CASE
            WHEN ((dt_alta IS NOT NULL) AND (TRIM(BOTH FROM dt_alta) <> ''::text) AND (length(TRIM(BOTH FROM dt_alta)) > 10)) THEN
            CASE
                WHEN ((dt_alta)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_alta)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_alta)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_alta)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_alta,
        CASE
            WHEN ((dt_lib_medico IS NOT NULL) AND (TRIM(BOTH FROM dt_lib_medico) <> ''::text) AND (length(TRIM(BOTH FROM dt_lib_medico)) > 10)) THEN
            CASE
                WHEN ((dt_lib_medico)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_lib_medico)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_lib_medico)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_lib_medico)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_lib_medico,
        CASE
            WHEN ((dt_medicacao IS NOT NULL) AND (TRIM(BOTH FROM dt_medicacao) <> ''::text) AND (length(TRIM(BOTH FROM dt_medicacao)) > 10)) THEN
            CASE
                WHEN ((dt_medicacao)::text ~ '^\d{4}-\d{2}-\d{2}'::text) THEN ((dt_medicacao)::timestamp without time zone)::timestamp with time zone
                WHEN ((dt_medicacao)::text ~ '^\d{2}/\d{2}/\d{2,4}'::text) THEN to_timestamp((dt_medicacao)::text, 'DD/MM/YY HH24:MI:SS'::text)
                ELSE NULL::timestamp with time zone
            END
            ELSE NULL::timestamp with time zone
        END AS dt_medicacao
   FROM public.painel_ps_analise;


--
-- Name: vw_ps_atendimentos_por_hora; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_atendimentos_por_hora AS
 SELECT (EXTRACT(hour FROM (dt_entrada)::timestamp without time zone))::integer AS hora,
    count(*) AS total_atendimentos,
    count(*) FILTER (WHERE ((hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text))) AS atendidos,
    count(*) FILTER (WHERE ((hr_inicio_consulta IS NULL) OR (TRIM(BOTH FROM hr_inicio_consulta) = ''::text))) AS aguardando
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE))
  GROUP BY (EXTRACT(hour FROM (dt_entrada)::timestamp without time zone))
  ORDER BY ((EXTRACT(hour FROM (dt_entrada)::timestamp without time zone))::integer);


--
-- Name: vw_ps_dashboard_dia; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_dashboard_dia AS
 SELECT COALESCE(count(*), (0)::bigint) AS total_atendimentos_dia,
    COALESCE(count(*) FILTER (WHERE ((hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text))), (0)::bigint) AS atendimentos_realizados,
    COALESCE(count(*) FILTER (WHERE ((hr_inicio_consulta IS NULL) OR (TRIM(BOTH FROM hr_inicio_consulta) = ''::text))), (0)::bigint) AS aguardando_atendimento,
    COALESCE(count(*) FILTER (WHERE ((dt_alta IS NOT NULL) AND (TRIM(BOTH FROM dt_alta) <> ''::text))), (0)::bigint) AS pacientes_alta,
    COALESCE(round(avg(
        CASE
            WHEN ((dt_alta IS NOT NULL) AND (TRIM(BOTH FROM dt_alta) <> ''::text) AND (length(TRIM(BOTH FROM dt_alta)) > 10) AND (dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN (EXTRACT(epoch FROM ((dt_alta)::timestamp without time zone - (dt_entrada)::timestamp without time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_medio_permanencia_min,
    COALESCE(round(avg(
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10) AND (dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN (EXTRACT(epoch FROM ((dt_inicio_atendimento)::timestamp without time zone - (dt_entrada)::timestamp without time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_medio_espera_consulta_min
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE));


--
-- Name: vw_ps_desempenho_medico; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_desempenho_medico AS
 SELECT cd_medico_resp,
    nm_guerra,
    count(*) AS total_atendimentos,
    COALESCE(round(avg(
        CASE
            WHEN ((hr_fim_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_fim_consulta) <> ''::text) AND (hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text) AND (dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN (EXTRACT(epoch FROM ((date((dt_entrada)::timestamp without time zone) + (TRIM(BOTH FROM hr_fim_consulta))::time without time zone) - (date((dt_entrada)::timestamp without time zone) + (TRIM(BOTH FROM hr_inicio_consulta))::time without time zone))) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_medio_atendimento_min,
    count(*) FILTER (WHERE ((dt_alta IS NOT NULL) AND (TRIM(BOTH FROM dt_alta) <> ''::text))) AS pacientes_finalizados
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE) AND (cd_medico_resp IS NOT NULL) AND (TRIM(BOTH FROM cd_medico_resp) <> ''::text) AND (hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text))
  GROUP BY cd_medico_resp, nm_guerra
  ORDER BY (count(*)) DESC;


--
-- Name: vw_ps_desempenho_recepcao; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_desempenho_recepcao AS
 SELECT count(*) AS total_recebidos,
    COALESCE(round(avg(
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10) AND (dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN (EXTRACT(epoch FROM ((dt_inicio_atendimento)::timestamp without time zone - (dt_entrada)::timestamp without time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_medio_recepcao_min,
    count(*) FILTER (WHERE ((dt_inicio_atendimento IS NULL) OR (TRIM(BOTH FROM dt_inicio_atendimento) = ''::text))) AS aguardando_recepcao
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE));


--
-- Name: vw_ps_perfil_horario_semanal; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_perfil_horario_semanal AS
 WITH totais_dia_hora AS (
         SELECT (EXTRACT(dow FROM ml_ps_historico_chegadas.dt_entrada))::integer AS dia_semana,
            (EXTRACT(hour FROM ml_ps_historico_chegadas.dt_entrada))::integer AS hora,
            (count(*))::numeric AS atendimentos
           FROM public.ml_ps_historico_chegadas
          WHERE ((ml_ps_historico_chegadas.dt_entrada >= (CURRENT_DATE - '365 days'::interval)) AND (ml_ps_historico_chegadas.dt_entrada < CURRENT_DATE))
          GROUP BY (EXTRACT(dow FROM ml_ps_historico_chegadas.dt_entrada)), (EXTRACT(hour FROM ml_ps_historico_chegadas.dt_entrada))
        ), totais_dia AS (
         SELECT totais_dia_hora.dia_semana,
            sum(totais_dia_hora.atendimentos) AS total_dia
           FROM totais_dia_hora
          GROUP BY totais_dia_hora.dia_semana
        )
 SELECT tdh.dia_semana,
    tdh.hora,
    tdh.atendimentos,
    td.total_dia,
    round(((tdh.atendimentos / NULLIF(td.total_dia, (0)::numeric)) * (100)::numeric), 3) AS pct_do_dia
   FROM (totais_dia_hora tdh
     JOIN totais_dia td ON ((td.dia_semana = tdh.dia_semana)))
  ORDER BY tdh.dia_semana, tdh.hora;


--
-- Name: vw_ps_tempo_por_clinica; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_ps_tempo_por_clinica AS
 SELECT ds_clinica,
    count(*) AS total_atendimentos,
    COALESCE(round(avg(
        CASE
            WHEN ((dt_inicio_atendimento IS NOT NULL) AND (TRIM(BOTH FROM dt_inicio_atendimento) <> ''::text) AND (length(TRIM(BOTH FROM dt_inicio_atendimento)) > 10) AND (dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10)) THEN (EXTRACT(epoch FROM ((dt_inicio_atendimento)::timestamp without time zone - (dt_entrada)::timestamp without time zone)) / (60)::numeric)
            ELSE NULL::numeric
        END), 0), (0)::numeric) AS tempo_medio_espera_min,
    count(*) FILTER (WHERE ((hr_inicio_consulta IS NOT NULL) AND (TRIM(BOTH FROM hr_inicio_consulta) <> ''::text))) AS atendimentos_realizados,
    count(*) FILTER (WHERE ((hr_inicio_consulta IS NULL) OR (TRIM(BOTH FROM hr_inicio_consulta) = ''::text))) AS aguardando_atendimento
   FROM public.painel_ps_analise
  WHERE ((dt_entrada IS NOT NULL) AND (TRIM(BOTH FROM dt_entrada) <> ''::text) AND (length(TRIM(BOTH FROM dt_entrada)) > 10) AND ((dt_entrada)::timestamp without time zone >= CURRENT_DATE) AND (ds_clinica IS NOT NULL) AND (TRIM(BOTH FROM ds_clinica) <> ''::text))
  GROUP BY ds_clinica
  ORDER BY (count(*)) DESC;


--
-- Name: vw_sentir_agir_avaliacoes_detalhadas; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_avaliacoes_detalhadas AS
 SELECT a.id AS avaliacao_id,
    a.visita_id,
    v.ronda_id,
    r.data_ronda,
    (((d.nome_visitante_1)::text || ' e '::text) || (d.nome_visitante_2)::text) AS dupla_nome,
    s.nome AS setor_nome,
    v.leito,
    v.nr_atendimento,
    c.id AS categoria_id,
    c.nome AS categoria_nome,
    c.icone AS categoria_icone,
    i.id AS item_id,
    i.descricao AS item_descricao,
    a.resultado,
    a.criado_em
   FROM ((((((public.sentir_agir_avaliacoes a
     JOIN public.sentir_agir_itens i ON ((i.id = a.item_id)))
     JOIN public.sentir_agir_categorias c ON ((c.id = i.categoria_id)))
     JOIN public.sentir_agir_visitas v ON ((v.id = a.visita_id)))
     JOIN public.sentir_agir_rondas r ON ((r.id = v.ronda_id)))
     JOIN public.sentir_agir_duplas d ON ((d.id = r.dupla_id)))
     JOIN public.sentir_agir_setores s ON ((s.id = v.setor_id)));


--
-- Name: vw_sentir_agir_fila_pacientes; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_fila_pacientes AS
 SELECT o.nr_atendimento,
    o.nm_pessoa_fisica AS nm_paciente,
    TRIM(BOTH FROM o.cd_unidade_basica) AS leito,
    o."OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)" AS setor_ocupacao,
    o.cd_setor_atendimento,
    m.setor_sa_id,
    sa_s.nome AS setor_sa_nome,
    sa_s.sigla AS setor_sa_sigla,
    o.dt_entrada_unidade,
    o.qt_dia_permanencia,
    o.ds_clinica,
    o.nm_guerra AS medico_responsavel,
    o.ds_convenio,
    o.ds_tipo_acomodacao,
    ( SELECT max(v2.criado_em) AS max
           FROM public.sentir_agir_visitas v2
          WHERE ((v2.nr_atendimento)::text = (o.nr_atendimento)::text)) AS ultima_ronda_em,
    (EXTRACT(epoch FROM (now() - (( SELECT max(v3.criado_em) AS max
           FROM public.sentir_agir_visitas v3
          WHERE ((v3.nr_atendimento)::text = (o.nr_atendimento)::text)))::timestamp with time zone)) / 3600.0) AS horas_desde_ultima_ronda,
        CASE
            WHEN (( SELECT max(v4.criado_em) AS max
               FROM public.sentir_agir_visitas v4
              WHERE ((v4.nr_atendimento)::text = (o.nr_atendimento)::text)) IS NULL) THEN 1
            ELSE 2
        END AS prioridade
   FROM ((public.ocupacao_hospitalar o
     JOIN public.sentir_agir_setor_mapeamento m ON ((m.cd_setor_ocupacao = o.cd_setor_atendimento)))
     JOIN public.sentir_agir_setores sa_s ON ((sa_s.id = m.setor_sa_id)))
  WHERE ((o.ie_status_unidade = 'P'::bpchar) AND (o.nr_atendimento IS NOT NULL) AND ((NOT (EXISTS ( SELECT 1
           FROM public.sentir_agir_visitas v5
          WHERE ((v5.nr_atendimento)::text = (o.nr_atendimento)::text)))) OR (( SELECT max(v6.criado_em) AS max
           FROM public.sentir_agir_visitas v6
          WHERE ((v6.nr_atendimento)::text = (o.nr_atendimento)::text)) < (now() - ( SELECT (((COALESCE(sentir_agir_config.valor, '48'::text))::integer)::double precision * '01:00:00'::interval)
           FROM public.sentir_agir_config
          WHERE ((sentir_agir_config.chave)::text = 'fila_cooldown_horas'::text))))))
  ORDER BY
        CASE
            WHEN (( SELECT max(v4.criado_em) AS max
               FROM public.sentir_agir_visitas v4
              WHERE ((v4.nr_atendimento)::text = (o.nr_atendimento)::text)) IS NULL) THEN 1
            ELSE 2
        END, o.qt_dia_permanencia DESC NULLS LAST, o.dt_entrada_unidade;


--
-- Name: vw_sentir_agir_ranking_criticos; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_ranking_criticos AS
 SELECT c.nome AS categoria_nome,
    i.descricao AS item_descricao,
    count(*) AS total_avaliacoes,
    sum(
        CASE
            WHEN ((a.resultado)::text = 'critico'::text) THEN 1
            ELSE 0
        END) AS total_critico,
    sum(
        CASE
            WHEN ((a.resultado)::text = 'atencao'::text) THEN 1
            ELSE 0
        END) AS total_atencao,
    sum(
        CASE
            WHEN ((a.resultado)::text = 'adequado'::text) THEN 1
            ELSE 0
        END) AS total_adequado,
    round(((100.0 * (sum(
        CASE
            WHEN ((a.resultado)::text = 'critico'::text) THEN 1
            ELSE 0
        END))::numeric) / (NULLIF(sum(
        CASE
            WHEN ((a.resultado)::text <> 'nao_aplica'::text) THEN 1
            ELSE 0
        END), 0))::numeric), 1) AS percentual_critico
   FROM ((public.sentir_agir_avaliacoes a
     JOIN public.sentir_agir_itens i ON ((i.id = a.item_id)))
     JOIN public.sentir_agir_categorias c ON ((c.id = i.categoria_id)))
  GROUP BY c.nome, i.descricao
  ORDER BY (sum(
        CASE
            WHEN ((a.resultado)::text = 'critico'::text) THEN 1
            ELSE 0
        END)) DESC, (round(((100.0 * (sum(
        CASE
            WHEN ((a.resultado)::text = 'critico'::text) THEN 1
            ELSE 0
        END))::numeric) / (NULLIF(sum(
        CASE
            WHEN ((a.resultado)::text <> 'nao_aplica'::text) THEN 1
            ELSE 0
        END), 0))::numeric), 1)) DESC;


--
-- Name: vw_sentir_agir_resumo_diario; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_resumo_diario AS
 SELECT r.data_ronda,
    count(DISTINCT r.id) AS total_rondas,
    count(DISTINCT v.id) AS total_visitas,
    count(DISTINCT v.leito) AS total_leitos_visitados,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'critico'::text) THEN 1
            ELSE 0
        END) AS visitas_criticas,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'atencao'::text) THEN 1
            ELSE 0
        END) AS visitas_atencao,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'adequado'::text) THEN 1
            ELSE 0
        END) AS visitas_adequadas
   FROM (public.sentir_agir_rondas r
     LEFT JOIN public.sentir_agir_visitas v ON ((v.ronda_id = r.id)))
  WHERE ((r.status)::text <> 'cancelada'::text)
  GROUP BY r.data_ronda
  ORDER BY r.data_ronda DESC;


--
-- Name: vw_sentir_agir_resumo_setor; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_resumo_setor AS
 SELECT s.id AS setor_id,
    s.nome AS setor_nome,
    r.data_ronda,
    count(DISTINCT v.id) AS total_visitas,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'critico'::text) THEN 1
            ELSE 0
        END) AS visitas_criticas,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'atencao'::text) THEN 1
            ELSE 0
        END) AS visitas_atencao,
    sum(
        CASE
            WHEN ((v.avaliacao_final)::text = 'adequado'::text) THEN 1
            ELSE 0
        END) AS visitas_adequadas
   FROM ((public.sentir_agir_visitas v
     JOIN public.sentir_agir_rondas r ON ((r.id = v.ronda_id)))
     JOIN public.sentir_agir_setores s ON ((s.id = v.setor_id)))
  WHERE ((r.status)::text <> 'cancelada'::text)
  GROUP BY s.id, s.nome, r.data_ronda
  ORDER BY r.data_ronda DESC, s.nome;


--
-- Name: vw_sentir_agir_tratativas_completas; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_tratativas_completas AS
 SELECT t.id AS tratativa_id,
    t.visita_id,
    t.status,
    t.prioridade,
    t.descricao_problema,
    t.plano_acao,
    t.observacoes_resolucao,
    t.data_inicio_tratativa,
    t.data_resolucao,
    t.resolvido_por,
    t.criado_em AS tratativa_criada_em,
    t.atualizado_em AS tratativa_atualizada_em,
    i.descricao AS item_descricao,
    COALESCE(i.tipo, 'semaforo'::character varying) AS item_tipo,
    c.id AS categoria_id,
    c.nome AS categoria_nome,
    c.icone AS categoria_icone,
    c.cor AS categoria_cor,
    t.responsavel_id,
    r.nome AS responsavel_nome,
    r.email AS responsavel_email,
    r.cargo AS responsavel_cargo,
    t.responsavel_nome_manual,
    COALESCE(r.nome, t.responsavel_nome_manual, 'Sem responsável'::character varying) AS responsavel_display,
    v.leito,
    v.nr_atendimento,
    v.nm_paciente,
    v.setor_ocupacao,
    v.observacoes AS visita_observacoes,
    v.criado_em AS visita_criada_em,
    s.id AS setor_sa_id,
    s.nome AS setor_sa_nome,
    s.sigla AS setor_sa_sigla,
    ro.id AS ronda_id,
    ro.data_ronda,
    (((d.nome_visitante_1)::text || ' e '::text) || (d.nome_visitante_2)::text) AS dupla_nome,
    (EXTRACT(epoch FROM (now() - (t.criado_em)::timestamp with time zone)) / 86400.0) AS dias_em_aberto
   FROM (((((((public.sentir_agir_tratativas t
     JOIN public.sentir_agir_visitas v ON ((v.id = t.visita_id)))
     JOIN public.sentir_agir_itens i ON ((i.id = t.item_id)))
     JOIN public.sentir_agir_categorias c ON ((c.id = t.categoria_id)))
     JOIN public.sentir_agir_setores s ON ((s.id = v.setor_id)))
     JOIN public.sentir_agir_rondas ro ON ((ro.id = v.ronda_id)))
     JOIN public.sentir_agir_duplas d ON ((d.id = ro.dupla_id)))
     LEFT JOIN public.sentir_agir_responsaveis r ON ((r.id = t.responsavel_id)));


--
-- Name: vw_sentir_agir_visitas_completas; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_sentir_agir_visitas_completas AS
 SELECT v.id AS visita_id,
    v.ronda_id,
    r.data_ronda,
    r.status AS status_ronda,
    r.criado_por,
    d.id AS dupla_id,
    (((d.nome_visitante_1)::text || ' e '::text) || (d.nome_visitante_2)::text) AS dupla_nome,
    s.id AS setor_id,
    s.nome AS setor_nome,
    s.sigla AS setor_sigla,
    v.leito,
    v.nr_atendimento,
    v.avaliacao_final,
    v.observacoes,
    v.criado_em AS visita_criada_em,
    v.atualizado_em AS visita_atualizada_em,
    ( SELECT count(*) AS count
           FROM public.sentir_agir_avaliacoes a
          WHERE ((a.visita_id = v.id) AND ((a.resultado)::text = 'critico'::text))) AS qtd_critico,
    ( SELECT count(*) AS count
           FROM public.sentir_agir_avaliacoes a
          WHERE ((a.visita_id = v.id) AND ((a.resultado)::text = 'atencao'::text))) AS qtd_atencao,
    ( SELECT count(*) AS count
           FROM public.sentir_agir_avaliacoes a
          WHERE ((a.visita_id = v.id) AND ((a.resultado)::text = 'adequado'::text))) AS qtd_adequado,
    ( SELECT count(*) AS count
           FROM public.sentir_agir_avaliacoes a
          WHERE ((a.visita_id = v.id) AND ((a.resultado)::text = 'nao_aplica'::text))) AS qtd_nao_aplica,
    ( SELECT count(*) AS count
           FROM public.sentir_agir_imagens i
          WHERE (i.visita_id = v.id)) AS qtd_imagens
   FROM (((public.sentir_agir_visitas v
     JOIN public.sentir_agir_rondas r ON ((r.id = v.ronda_id)))
     JOIN public.sentir_agir_duplas d ON ((d.id = r.dupla_id)))
     JOIN public.sentir_agir_setores s ON ((s.id = v.setor_id)));


--
-- Name: access_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_log ALTER COLUMN id SET DEFAULT nextval('public.access_log_id_seq'::regclass);


--
-- Name: agenda_paciente_cirurgias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_paciente_cirurgias ALTER COLUMN id SET DEFAULT nextval('public.agenda_paciente_cirurgias_id_seq'::regclass);


--
-- Name: chamados id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados ALTER COLUMN id SET DEFAULT nextval('public.chamados_id_seq'::regclass);


--
-- Name: chamados_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_config ALTER COLUMN id SET DEFAULT nextval('public.chamados_config_id_seq'::regclass);


--
-- Name: chamados_historico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_historico ALTER COLUMN id SET DEFAULT nextval('public.chamados_historico_id_seq'::regclass);


--
-- Name: chamados_locais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_locais ALTER COLUMN id SET DEFAULT nextval('public.chamados_locais_id_seq'::regclass);


--
-- Name: chamados_problemas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_problemas ALTER COLUMN id SET DEFAULT nextval('public.chamados_problemas_id_seq'::regclass);


--
-- Name: evolucao_turno id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolucao_turno ALTER COLUMN id SET DEFAULT nextval('public.evolucao_turno_id_seq'::regclass);


--
-- Name: historico_usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historico_usuarios ALTER COLUMN id SET DEFAULT nextval('public.historico_usuarios_id_seq'::regclass);


--
-- Name: hub_servicos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_servicos ALTER COLUMN id SET DEFAULT nextval('public.hub_servicos_id_seq'::regclass);


--
-- Name: medicos_ps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicos_ps ALTER COLUMN id SET DEFAULT nextval('public.medicos_ps_id_seq'::regclass);


--
-- Name: ml_faturamento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento ALTER COLUMN id SET DEFAULT nextval('public.ml_faturamento_id_seq'::regclass);


--
-- Name: ml_faturamento_predicoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento_predicoes ALTER COLUMN id SET DEFAULT nextval('public.ml_faturamento_predicoes_id_seq'::regclass);


--
-- Name: ml_internacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes ALTER COLUMN id SET DEFAULT nextval('public.ml_internacoes_id_seq'::regclass);


--
-- Name: ml_internacoes_predicoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes_predicoes ALTER COLUMN id SET DEFAULT nextval('public.ml_internacoes_predicoes_id_seq'::regclass);


--
-- Name: ml_modelos_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_modelos_registry ALTER COLUMN id SET DEFAULT nextval('public.ml_modelos_registry_id_seq'::regclass);


--
-- Name: ml_ps_metricas_diarias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_metricas_diarias ALTER COLUMN id SET DEFAULT nextval('public.ml_ps_metricas_diarias_id_seq'::regclass);


--
-- Name: ml_ps_predicoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_predicoes ALTER COLUMN id SET DEFAULT nextval('public.ml_ps_predicoes_id_seq'::regclass);


--
-- Name: notificacoes_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_config ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_config_id_seq'::regclass);


--
-- Name: notificacoes_destinatarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_destinatarios ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_destinatarios_id_seq'::regclass);


--
-- Name: notificacoes_historico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_historico ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_historico_id_seq'::regclass);


--
-- Name: notificacoes_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_log ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_log_id_seq'::regclass);


--
-- Name: notificacoes_snapshot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_snapshot ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_snapshot_id_seq'::regclass);


--
-- Name: notificacoes_tipos_evento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_tipos_evento ALTER COLUMN id SET DEFAULT nextval('public.notificacoes_tipos_evento_id_seq'::regclass);


--
-- Name: nutricao_cadastros id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_cadastros ALTER COLUMN id SET DEFAULT nextval('public.nutricao_cadastros_id_seq'::regclass);


--
-- Name: nutricao_refeicoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_refeicoes ALTER COLUMN id SET DEFAULT nextval('public.nutricao_refeicoes_id_seq'::regclass);


--
-- Name: nutricao_restricoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_restricoes ALTER COLUMN id SET DEFAULT nextval('public.nutricao_restricoes_id_seq'::regclass);


--
-- Name: nutricao_solicitacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes ALTER COLUMN id SET DEFAULT nextval('public.nutricao_solicitacoes_id_seq'::regclass);


--
-- Name: nutricao_tipos_dieta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_tipos_dieta ALTER COLUMN id SET DEFAULT nextval('public.nutricao_tipos_dieta_id_seq'::regclass);


--
-- Name: ocupacao_hospitalar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacao_hospitalar ALTER COLUMN id SET DEFAULT nextval('public.ocupacao_hospitalar_id_seq'::regclass);


--
-- Name: p27_exames_lab id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_exames_lab ALTER COLUMN id SET DEFAULT nextval('public.p27_exames_lab_id_seq'::regclass);


--
-- Name: p27_historico_exames id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_historico_exames ALTER COLUMN id SET DEFAULT nextval('public.p27_historico_exames_id_seq'::regclass);


--
-- Name: p27_historico_sinais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_historico_sinais ALTER COLUMN id SET DEFAULT nextval('public.p27_historico_sinais_id_seq'::regclass);


--
-- Name: p27_pacientes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_pacientes ALTER COLUMN id SET DEFAULT nextval('public.p27_pacientes_id_seq'::regclass);


--
-- Name: padioleiro_cadastros id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_cadastros ALTER COLUMN id SET DEFAULT nextval('public.padioleiro_cadastros_id_seq'::regclass);


--
-- Name: padioleiro_chamados id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_chamados ALTER COLUMN id SET DEFAULT nextval('public.padioleiro_chamados_id_seq'::regclass);


--
-- Name: padioleiro_destinos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_destinos ALTER COLUMN id SET DEFAULT nextval('public.padioleiro_destinos_id_seq'::regclass);


--
-- Name: padioleiro_origens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_origens ALTER COLUMN id SET DEFAULT nextval('public.padioleiro_origens_id_seq'::regclass);


--
-- Name: padioleiro_tipos_movimento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_tipos_movimento ALTER COLUMN id SET DEFAULT nextval('public.padioleiro_tipos_movimento_id_seq'::regclass);


--
-- Name: painel16_atendimentos_dia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel16_atendimentos_dia ALTER COLUMN id SET DEFAULT nextval('public.painel16_atendimentos_dia_id_seq'::regclass);


--
-- Name: painel16_maquinas_recepcao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel16_maquinas_recepcao ALTER COLUMN id SET DEFAULT nextval('public.painel16_maquinas_recepcao_id_seq'::regclass);


--
-- Name: painel17_atendimentos_ps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel17_atendimentos_ps ALTER COLUMN id SET DEFAULT nextval('public.painel17_atendimentos_ps_id_seq'::regclass);


--
-- Name: painel19_radiologia_pendencias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel19_radiologia_pendencias ALTER COLUMN id SET DEFAULT nextval('public.painel19_radiologia_pendencias_id_seq'::regclass);


--
-- Name: painel21_contas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel21_contas ALTER COLUMN id SET DEFAULT nextval('public.painel21_contas_id_seq'::regclass);


--
-- Name: painel22_exames_ps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel22_exames_ps ALTER COLUMN id SET DEFAULT nextval('public.painel22_exames_ps_id_seq'::regclass);


--
-- Name: painel23_atendimentos_amb id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel23_atendimentos_amb ALTER COLUMN id SET DEFAULT nextval('public.painel23_atendimentos_amb_id_seq'::regclass);


--
-- Name: painel24_estoque_dia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel24_estoque_dia ALTER COLUMN id SET DEFAULT nextval('public.painel24_estoque_dia_id_seq'::regclass);


--
-- Name: painel25_ps_exames_medico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel25_ps_exames_medico ALTER COLUMN id SET DEFAULT nextval('public.painel25_ps_exames_medico_id_seq'::regclass);


--
-- Name: painel33_responsaveis_convenio id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_responsaveis_convenio ALTER COLUMN id SET DEFAULT nextval('public.painel33_responsaveis_convenio_id_seq'::regclass);


--
-- Name: painel39_interacoes_dieta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel39_interacoes_dieta ALTER COLUMN id SET DEFAULT nextval('public.painel39_interacoes_dieta_id_seq'::regclass);


--
-- Name: painel40_requisicoes_urgentes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel40_requisicoes_urgentes ALTER COLUMN id SET DEFAULT nextval('public.painel40_requisicoes_urgentes_id_seq'::regclass);


--
-- Name: painel_cirurgias_hemodinamica id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_cirurgias_hemodinamica ALTER COLUMN id SET DEFAULT nextval('public.painel_cirurgias_hemodinamica_id_seq'::regclass);


--
-- Name: painel_clinico_analise_ia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_clinico_analise_ia ALTER COLUMN id SET DEFAULT nextval('public.painel_clinico_analise_ia_id_seq'::regclass);


--
-- Name: painel_plano_terapeutico_enfermagem id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_plano_terapeutico_enfermagem ALTER COLUMN id SET DEFAULT nextval('public.painel_plano_terapeutico_enfermagem_id_seq'::regclass);


--
-- Name: painel_prescricoes_nutricao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_prescricoes_nutricao ALTER COLUMN id SET DEFAULT nextval('public.painel_prescricoes_nutricao_id_seq'::regclass);


--
-- Name: painel_producao_mensal id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_producao_mensal ALTER COLUMN id SET DEFAULT nextval('public.painel_producao_mensal_id_seq'::regclass);


--
-- Name: painel_ps_atendimentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_ps_atendimentos ALTER COLUMN id SET DEFAULT nextval('public.painel_ps_atendimentos_id_seq'::regclass);


--
-- Name: painel_ps_conversao_internacao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_ps_conversao_internacao ALTER COLUMN id SET DEFAULT nextval('public.painel_ps_conversao_internacao_id_seq'::regclass);


--
-- Name: painel_score_farmaceutico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_score_farmaceutico ALTER COLUMN id SET DEFAULT nextval('public.painel_score_farmaceutico_id_seq'::regclass);


--
-- Name: painel_sepse_analise_ia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_sepse_analise_ia ALTER COLUMN id SET DEFAULT nextval('public.painel_sepse_analise_ia_id_seq'::regclass);


--
-- Name: permissoes_paineis id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes_paineis ALTER COLUMN id SET DEFAULT nextval('public.permissoes_paineis_id_seq'::regclass);


--
-- Name: sentir_agir_analises_categorias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_categorias ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_analises_categorias_id_seq'::regclass);


--
-- Name: sentir_agir_analises_ia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_ia ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_analises_ia_id_seq'::regclass);


--
-- Name: sentir_agir_avaliacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_avaliacoes ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_avaliacoes_id_seq'::regclass);


--
-- Name: sentir_agir_categorias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_categorias ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_categorias_id_seq'::regclass);


--
-- Name: sentir_agir_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_config ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_config_id_seq'::regclass);


--
-- Name: sentir_agir_duplas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_duplas ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_duplas_id_seq'::regclass);


--
-- Name: sentir_agir_imagens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_imagens ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_imagens_id_seq'::regclass);


--
-- Name: sentir_agir_itens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_itens ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_itens_id_seq'::regclass);


--
-- Name: sentir_agir_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_log ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_log_id_seq'::regclass);


--
-- Name: sentir_agir_responsaveis id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsaveis ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_responsaveis_id_seq'::regclass);


--
-- Name: sentir_agir_responsavel_categorias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_categorias ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_responsavel_categorias_id_seq'::regclass);


--
-- Name: sentir_agir_responsavel_setores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_setores ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_responsavel_setores_id_seq'::regclass);


--
-- Name: sentir_agir_rondas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_rondas ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_rondas_id_seq'::regclass);


--
-- Name: sentir_agir_setor_mapeamento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_setor_mapeamento ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_setor_mapeamento_id_seq'::regclass);


--
-- Name: sentir_agir_setores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_setores ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_setores_id_seq'::regclass);


--
-- Name: sentir_agir_tratativas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_tratativas_id_seq'::regclass);


--
-- Name: sentir_agir_visitas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_visitas ALTER COLUMN id SET DEFAULT nextval('public.sentir_agir_visitas_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: access_log access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_log
    ADD CONSTRAINT access_log_pkey PRIMARY KEY (id);


--
-- Name: agenda_paciente_cirurgias agenda_paciente_cirurgias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_paciente_cirurgias
    ADD CONSTRAINT agenda_paciente_cirurgias_pkey PRIMARY KEY (id);


--
-- Name: chamados_config chamados_config_chave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_config
    ADD CONSTRAINT chamados_config_chave_key UNIQUE (chave);


--
-- Name: chamados_config chamados_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_config
    ADD CONSTRAINT chamados_config_pkey PRIMARY KEY (id);


--
-- Name: chamados_historico chamados_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_historico
    ADD CONSTRAINT chamados_historico_pkey PRIMARY KEY (id);


--
-- Name: chamados_locais chamados_locais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_locais
    ADD CONSTRAINT chamados_locais_pkey PRIMARY KEY (id);


--
-- Name: chamados chamados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados
    ADD CONSTRAINT chamados_pkey PRIMARY KEY (id);


--
-- Name: chamados_problemas chamados_problemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_problemas
    ADD CONSTRAINT chamados_problemas_pkey PRIMARY KEY (id);


--
-- Name: evolucao_turno evolucao_turno_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolucao_turno
    ADD CONSTRAINT evolucao_turno_pkey PRIMARY KEY (id);


--
-- Name: historico_usuarios historico_usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historico_usuarios
    ADD CONSTRAINT historico_usuarios_pkey PRIMARY KEY (id);


--
-- Name: hub_servicos hub_servicos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_servicos
    ADD CONSTRAINT hub_servicos_pkey PRIMARY KEY (id);


--
-- Name: medicos_ps medicos_ps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicos_ps
    ADD CONSTRAINT medicos_ps_pkey PRIMARY KEY (id);


--
-- Name: ml_faturamento ml_faturamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento
    ADD CONSTRAINT ml_faturamento_pkey PRIMARY KEY (id);


--
-- Name: ml_faturamento_predicoes ml_faturamento_predicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento_predicoes
    ADD CONSTRAINT ml_faturamento_predicoes_pkey PRIMARY KEY (id);


--
-- Name: ml_faturamento_setor_mapping ml_faturamento_setor_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento_setor_mapping
    ADD CONSTRAINT ml_faturamento_setor_mapping_pkey PRIMARY KEY (cd_setor);


--
-- Name: ml_internacoes ml_internacoes_nr_atendimento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes
    ADD CONSTRAINT ml_internacoes_nr_atendimento_key UNIQUE (nr_atendimento);


--
-- Name: ml_internacoes ml_internacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes
    ADD CONSTRAINT ml_internacoes_pkey PRIMARY KEY (id);


--
-- Name: ml_internacoes_predicoes ml_internacoes_predicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes_predicoes
    ADD CONSTRAINT ml_internacoes_predicoes_pkey PRIMARY KEY (id);


--
-- Name: ml_modelos_registry ml_modelos_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_modelos_registry
    ADD CONSTRAINT ml_modelos_registry_pkey PRIMARY KEY (id);


--
-- Name: ml_ps_metricas_diarias ml_ps_metricas_diarias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_metricas_diarias
    ADD CONSTRAINT ml_ps_metricas_diarias_pkey PRIMARY KEY (id);


--
-- Name: ml_ps_predicoes ml_ps_predicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_predicoes
    ADD CONSTRAINT ml_ps_predicoes_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_config notificacoes_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_config
    ADD CONSTRAINT notificacoes_config_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_destinatarios notificacoes_destinatarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_destinatarios
    ADD CONSTRAINT notificacoes_destinatarios_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_historico notificacoes_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_historico
    ADD CONSTRAINT notificacoes_historico_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_log notificacoes_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_log
    ADD CONSTRAINT notificacoes_log_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_snapshot notificacoes_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_snapshot
    ADD CONSTRAINT notificacoes_snapshot_pkey PRIMARY KEY (id);


--
-- Name: notificacoes_tipos_evento notificacoes_tipos_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_tipos_evento
    ADD CONSTRAINT notificacoes_tipos_evento_pkey PRIMARY KEY (id);


--
-- Name: nutricao_cadastros nutricao_cadastros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_cadastros
    ADD CONSTRAINT nutricao_cadastros_pkey PRIMARY KEY (id);


--
-- Name: nutricao_refeicoes nutricao_refeicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_refeicoes
    ADD CONSTRAINT nutricao_refeicoes_pkey PRIMARY KEY (id);


--
-- Name: nutricao_restricoes nutricao_restricoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_restricoes
    ADD CONSTRAINT nutricao_restricoes_pkey PRIMARY KEY (id);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_codigo_entrega_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_codigo_entrega_key UNIQUE (codigo_entrega);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_pkey PRIMARY KEY (id);


--
-- Name: nutricao_tipos_dieta nutricao_tipos_dieta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_tipos_dieta
    ADD CONSTRAINT nutricao_tipos_dieta_pkey PRIMARY KEY (id);


--
-- Name: ocupacao_hospitalar ocupacao_hospitalar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacao_hospitalar
    ADD CONSTRAINT ocupacao_hospitalar_pkey PRIMARY KEY (id);


--
-- Name: p27_exames_lab p27_exames_lab_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_exames_lab
    ADD CONSTRAINT p27_exames_lab_pkey PRIMARY KEY (id);


--
-- Name: p27_historico_exames p27_historico_exames_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_historico_exames
    ADD CONSTRAINT p27_historico_exames_pkey PRIMARY KEY (id);


--
-- Name: p27_historico_sinais p27_historico_sinais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_historico_sinais
    ADD CONSTRAINT p27_historico_sinais_pkey PRIMARY KEY (id);


--
-- Name: p27_pacientes p27_pacientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p27_pacientes
    ADD CONSTRAINT p27_pacientes_pkey PRIMARY KEY (id);


--
-- Name: padioleiro_cadastros padioleiro_cadastros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_cadastros
    ADD CONSTRAINT padioleiro_cadastros_pkey PRIMARY KEY (id);


--
-- Name: padioleiro_chamados padioleiro_chamados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_chamados
    ADD CONSTRAINT padioleiro_chamados_pkey PRIMARY KEY (id);


--
-- Name: padioleiro_destinos padioleiro_destinos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_destinos
    ADD CONSTRAINT padioleiro_destinos_pkey PRIMARY KEY (id);


--
-- Name: padioleiro_origens padioleiro_origens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_origens
    ADD CONSTRAINT padioleiro_origens_pkey PRIMARY KEY (id);


--
-- Name: padioleiro padioleiro_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro
    ADD CONSTRAINT padioleiro_pkey PRIMARY KEY (id);


--
-- Name: padioleiro_tipos_movimento padioleiro_tipos_movimento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_tipos_movimento
    ADD CONSTRAINT padioleiro_tipos_movimento_pkey PRIMARY KEY (id);


--
-- Name: painel16_atendimentos_dia painel16_atendimentos_dia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel16_atendimentos_dia
    ADD CONSTRAINT painel16_atendimentos_dia_pkey PRIMARY KEY (id);


--
-- Name: painel16_maquinas_recepcao painel16_maquinas_recepcao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel16_maquinas_recepcao
    ADD CONSTRAINT painel16_maquinas_recepcao_pkey PRIMARY KEY (id);


--
-- Name: painel17_atendimentos_ps painel17_atendimentos_ps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel17_atendimentos_ps
    ADD CONSTRAINT painel17_atendimentos_ps_pkey PRIMARY KEY (id);


--
-- Name: painel19_radiologia_pendencias painel19_radiologia_pendencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel19_radiologia_pendencias
    ADD CONSTRAINT painel19_radiologia_pendencias_pkey PRIMARY KEY (id);


--
-- Name: painel22_exames_ps painel22_exames_ps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel22_exames_ps
    ADD CONSTRAINT painel22_exames_ps_pkey PRIMARY KEY (id);


--
-- Name: painel23_atendimentos_amb painel23_atendimentos_amb_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel23_atendimentos_amb
    ADD CONSTRAINT painel23_atendimentos_amb_pkey PRIMARY KEY (id);


--
-- Name: painel24_estoque_dia painel24_estoque_dia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel24_estoque_dia
    ADD CONSTRAINT painel24_estoque_dia_pkey PRIMARY KEY (id);


--
-- Name: painel25_ps_exames_medico painel25_ps_exames_medico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel25_ps_exames_medico
    ADD CONSTRAINT painel25_ps_exames_medico_pkey PRIMARY KEY (id);


--
-- Name: painel33_autorizacao_documentos painel33_autorizacao_documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_autorizacao_documentos
    ADD CONSTRAINT painel33_autorizacao_documentos_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_autorizacao_materiais painel33_autorizacao_materiais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_autorizacao_materiais
    ADD CONSTRAINT painel33_autorizacao_materiais_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_autorizacao_procedimentos painel33_autorizacao_procedimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_autorizacao_procedimentos
    ADD CONSTRAINT painel33_autorizacao_procedimentos_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_autorizacoes_convenio painel33_autorizacoes_convenio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_autorizacoes_convenio
    ADD CONSTRAINT painel33_autorizacoes_convenio_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_contas_paciente painel33_contas_paciente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_contas_paciente
    ADD CONSTRAINT painel33_contas_paciente_pkey PRIMARY KEY (nr_interno_conta);


--
-- Name: painel33_convenio_sla painel33_convenio_sla_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_convenio_sla
    ADD CONSTRAINT painel33_convenio_sla_pkey PRIMARY KEY (cd_convenio);


--
-- Name: painel33_materiais_conta painel33_materiais_conta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_materiais_conta
    ADD CONSTRAINT painel33_materiais_conta_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_procedimentos_conta painel33_procedimentos_conta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_procedimentos_conta
    ADD CONSTRAINT painel33_procedimentos_conta_pkey PRIMARY KEY (nr_sequencia);


--
-- Name: painel33_responsaveis_convenio painel33_responsaveis_convenio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel33_responsaveis_convenio
    ADD CONSTRAINT painel33_responsaveis_convenio_pkey PRIMARY KEY (id);


--
-- Name: painel_cirurgias_hemodinamica painel_cirurgias_hemodinamica_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_cirurgias_hemodinamica
    ADD CONSTRAINT painel_cirurgias_hemodinamica_pkey PRIMARY KEY (id);


--
-- Name: painel_clinico_analise_ia painel_clinico_analise_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_clinico_analise_ia
    ADD CONSTRAINT painel_clinico_analise_ia_pkey PRIMARY KEY (id);


--
-- Name: painel_plano_terapeutico_enfermagem painel_plano_terapeutico_enfermagem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_plano_terapeutico_enfermagem
    ADD CONSTRAINT painel_plano_terapeutico_enfermagem_pkey PRIMARY KEY (id);


--
-- Name: painel_prescricoes_nutricao painel_prescricoes_nutricao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_prescricoes_nutricao
    ADD CONSTRAINT painel_prescricoes_nutricao_pkey PRIMARY KEY (id);


--
-- Name: painel_producao_mensal painel_producao_mensal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_producao_mensal
    ADD CONSTRAINT painel_producao_mensal_pkey PRIMARY KEY (id);


--
-- Name: painel_ps_analise painel_ps_analise_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_ps_analise
    ADD CONSTRAINT painel_ps_analise_pkey PRIMARY KEY (nr_atendimento);


--
-- Name: painel_ps_atendimentos painel_ps_atendimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_ps_atendimentos
    ADD CONSTRAINT painel_ps_atendimentos_pkey PRIMARY KEY (id);


--
-- Name: painel_ps_conversao_internacao painel_ps_conversao_internacao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_ps_conversao_internacao
    ADD CONSTRAINT painel_ps_conversao_internacao_pkey PRIMARY KEY (id);


--
-- Name: painel_score_farmaceutico painel_score_farmaceutico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_score_farmaceutico
    ADD CONSTRAINT painel_score_farmaceutico_pkey PRIMARY KEY (id);


--
-- Name: painel_sepse_analise_ia painel_sepse_analise_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_sepse_analise_ia
    ADD CONSTRAINT painel_sepse_analise_ia_pkey PRIMARY KEY (id);


--
-- Name: permissoes_paineis permissoes_paineis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes_paineis
    ADD CONSTRAINT permissoes_paineis_pkey PRIMARY KEY (id);


--
-- Name: permissoes_paineis permissoes_paineis_usuario_id_painel_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes_paineis
    ADD CONSTRAINT permissoes_paineis_usuario_id_painel_nome_key UNIQUE (usuario_id, painel_nome);


--
-- Name: especialidade_medica pk_especialidade_medica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.especialidade_medica
    ADD CONSTRAINT pk_especialidade_medica PRIMARY KEY (cd_especialidade);


--
-- Name: ml_ps_historico_chegadas pk_ml_ps_historico_chegadas; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_historico_chegadas
    ADD CONSTRAINT pk_ml_ps_historico_chegadas PRIMARY KEY (nr_atendimento);


--
-- Name: painel20_radiologia_ps pk_painel20; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel20_radiologia_ps
    ADD CONSTRAINT pk_painel20 PRIMARY KEY (nr_prescricao, nr_seq_procedimento);


--
-- Name: painel21_contas pk_painel21_contas; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel21_contas
    ADD CONSTRAINT pk_painel21_contas PRIMARY KEY (id);


--
-- Name: painel39_interacoes_dieta pk_painel39_interacoes_dieta; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel39_interacoes_dieta
    ADD CONSTRAINT pk_painel39_interacoes_dieta PRIMARY KEY (id);


--
-- Name: painel40_requisicoes_urgentes pk_painel40_requisicoes_urgentes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel40_requisicoes_urgentes
    ADD CONSTRAINT pk_painel40_requisicoes_urgentes PRIMARY KEY (id);


--
-- Name: painel_clinico_tasy pk_painel_clinico_tasy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_clinico_tasy
    ADD CONSTRAINT pk_painel_clinico_tasy PRIMARY KEY (nr_atendimento);


--
-- Name: pareceres_pendentes pk_pareceres_pendentes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pareceres_pendentes
    ADD CONSTRAINT pk_pareceres_pendentes PRIMARY KEY (nr_parecer);


--
-- Name: pendencias_lab pk_pendencias_lab; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pendencias_lab
    ADD CONSTRAINT pk_pendencias_lab PRIMARY KEY (nr_atendimento);


--
-- Name: sentir_agir_analises_categorias sentir_agir_analises_categorias_data_referencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_categorias
    ADD CONSTRAINT sentir_agir_analises_categorias_data_referencia_key UNIQUE (data_referencia);


--
-- Name: sentir_agir_analises_categorias sentir_agir_analises_categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_categorias
    ADD CONSTRAINT sentir_agir_analises_categorias_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_analises_ia sentir_agir_analises_ia_data_analise_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_ia
    ADD CONSTRAINT sentir_agir_analises_ia_data_analise_key UNIQUE (data_analise);


--
-- Name: sentir_agir_analises_ia sentir_agir_analises_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_analises_ia
    ADD CONSTRAINT sentir_agir_analises_ia_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_avaliacoes sentir_agir_avaliacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_avaliacoes
    ADD CONSTRAINT sentir_agir_avaliacoes_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_categorias sentir_agir_categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_categorias
    ADD CONSTRAINT sentir_agir_categorias_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_config sentir_agir_config_chave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_config
    ADD CONSTRAINT sentir_agir_config_chave_key UNIQUE (chave);


--
-- Name: sentir_agir_config sentir_agir_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_config
    ADD CONSTRAINT sentir_agir_config_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_duplas sentir_agir_duplas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_duplas
    ADD CONSTRAINT sentir_agir_duplas_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_imagens sentir_agir_imagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_imagens
    ADD CONSTRAINT sentir_agir_imagens_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_itens sentir_agir_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_itens
    ADD CONSTRAINT sentir_agir_itens_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_log sentir_agir_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_log
    ADD CONSTRAINT sentir_agir_log_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_precaucao_contato sentir_agir_precaucao_contato_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_precaucao_contato
    ADD CONSTRAINT sentir_agir_precaucao_contato_pkey PRIMARY KEY (nr_atendimento);


--
-- Name: sentir_agir_responsaveis sentir_agir_responsaveis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsaveis
    ADD CONSTRAINT sentir_agir_responsaveis_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_responsavel_categorias sentir_agir_responsavel_categor_responsavel_id_categoria_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_categorias
    ADD CONSTRAINT sentir_agir_responsavel_categor_responsavel_id_categoria_id_key UNIQUE (responsavel_id, categoria_id);


--
-- Name: sentir_agir_responsavel_categorias sentir_agir_responsavel_categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_categorias
    ADD CONSTRAINT sentir_agir_responsavel_categorias_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_responsavel_setores sentir_agir_responsavel_setores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_setores
    ADD CONSTRAINT sentir_agir_responsavel_setores_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_responsavel_setores sentir_agir_responsavel_setores_responsavel_id_setor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_setores
    ADD CONSTRAINT sentir_agir_responsavel_setores_responsavel_id_setor_id_key UNIQUE (responsavel_id, setor_id);


--
-- Name: sentir_agir_rondas sentir_agir_rondas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_rondas
    ADD CONSTRAINT sentir_agir_rondas_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_setor_mapeamento sentir_agir_setor_mapeamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_setor_mapeamento
    ADD CONSTRAINT sentir_agir_setor_mapeamento_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_setores sentir_agir_setores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_setores
    ADD CONSTRAINT sentir_agir_setores_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_pkey PRIMARY KEY (id);


--
-- Name: sentir_agir_visitas sentir_agir_visitas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_visitas
    ADD CONSTRAINT sentir_agir_visitas_pkey PRIMARY KEY (id);


--
-- Name: setores_hospital setores_hospital_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setores_hospital
    ADD CONSTRAINT setores_hospital_pkey PRIMARY KEY (cd_setor);


--
-- Name: painel_clinico_analise_ia uk_analise_atendimento; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_clinico_analise_ia
    ADD CONSTRAINT uk_analise_atendimento UNIQUE (nr_atendimento);


--
-- Name: painel_prescricoes_nutricao uk_atendimento; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_prescricoes_nutricao
    ADD CONSTRAINT uk_atendimento UNIQUE (nr_atendimento);


--
-- Name: evolucao_turno uk_evolucao_turno; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolucao_turno
    ADD CONSTRAINT uk_evolucao_turno UNIQUE (nr_atendimento, data_turno, turno);


--
-- Name: ml_ps_metricas_diarias uk_metrica_dia_modelo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_metricas_diarias
    ADD CONSTRAINT uk_metrica_dia_modelo UNIQUE (dt_calculo, modelo_id, janela_dias);


--
-- Name: ml_modelos_registry uk_modelo_versao; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_modelos_registry
    ADD CONSTRAINT uk_modelo_versao UNIQUE (nome_modelo, versao);


--
-- Name: painel_sepse_analise_ia uk_painel_sepse_analise_nr_atendimento; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_sepse_analise_ia
    ADD CONSTRAINT uk_painel_sepse_analise_nr_atendimento UNIQUE (nr_atendimento, ie_ativo);


--
-- Name: ml_ps_predicoes uk_predicao_alvo_horizonte_modelo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_predicoes
    ADD CONSTRAINT uk_predicao_alvo_horizonte_modelo UNIQUE (dt_alvo, horizonte_dias, modelo_id);


--
-- Name: notificacoes_snapshot uk_snapshot_tipo_atend; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_snapshot
    ADD CONSTRAINT uk_snapshot_tipo_atend UNIQUE (tipo_snapshot, nr_atendimento);


--
-- Name: notificacoes_config uk_tipo_evento; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_config
    ADD CONSTRAINT uk_tipo_evento UNIQUE (tipo_evento);


--
-- Name: notificacoes_tipos_evento uk_tipo_evento_codigo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes_tipos_evento
    ADD CONSTRAINT uk_tipo_evento_codigo UNIQUE (codigo);


--
-- Name: medicos_ps uk_usuario_maquina_medicos_ps; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicos_ps
    ADD CONSTRAINT uk_usuario_maquina_medicos_ps UNIQUE (nm_usuario, nm_maq_cliente, logon_time);


--
-- Name: sentir_agir_avaliacoes uq_avaliacao_visita_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_avaliacoes
    ADD CONSTRAINT uq_avaliacao_visita_item UNIQUE (visita_id, item_id);


--
-- Name: ml_faturamento_predicoes uq_fat_pred_chave; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento_predicoes
    ADD CONSTRAINT uq_fat_pred_chave UNIQUE (dt_alvo, horizonte_dias, segmento);


--
-- Name: ml_internacoes_predicoes uq_intern_pred; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_internacoes_predicoes
    ADD CONSTRAINT uq_intern_pred UNIQUE (dt_alvo, horizonte_dias, segmento);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_usuario_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);


--


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

-- Name: idx_access_log_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_log_dt ON public.access_log USING btree (dt_acesso DESC);


--
-- Name: idx_access_log_ip_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_log_ip_dt ON public.access_log USING btree (ip, dt_acesso DESC);


--
-- Name: idx_access_log_painel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_log_painel ON public.access_log USING btree (painel_codigo, dt_acesso DESC);


--
-- Name: idx_access_log_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_access_log_tipo ON public.access_log USING btree (tipo_acesso, dt_acesso DESC);


--
-- Name: idx_analise_ia_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_analise_ia_atendimento ON public.painel_clinico_analise_ia USING btree (nr_atendimento);


--
-- Name: idx_analise_ia_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_analise_ia_ativo ON public.painel_clinico_analise_ia USING btree (ie_ativo);


--
-- Name: idx_analise_ia_criticidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_analise_ia_criticidade ON public.painel_clinico_analise_ia USING btree (nivel_criticidade);


--
-- Name: idx_analise_ia_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_analise_ia_data ON public.painel_clinico_analise_ia USING btree (dt_analise DESC);


--
-- Name: idx_analise_ia_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_analise_ia_hash ON public.painel_clinico_analise_ia USING btree (hash_dados);


--
-- Name: idx_avaliacoes_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_avaliacoes_item ON public.sentir_agir_avaliacoes USING btree (item_id);


--
-- Name: idx_avaliacoes_resultado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_avaliacoes_resultado ON public.sentir_agir_avaliacoes USING btree (resultado);


--
-- Name: idx_avaliacoes_visita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_avaliacoes_visita ON public.sentir_agir_avaliacoes USING btree (visita_id);


--
-- Name: idx_bi_conv_amb_c_ambulatorio_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_conv_amb_c_ambulatorio_lookup ON public.bi_conv_amb_c_ambulatorio USING btree (nr_atendimento);


--
-- Name: idx_bi_conv_amb_c_cirurgia_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_conv_amb_c_cirurgia_lookup ON public.bi_conv_amb_c_cirurgia USING btree (nr_atendimento);


--
-- Name: idx_bi_conv_amb_c_hemodinamica_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_conv_amb_c_hemodinamica_lookup ON public.bi_conv_amb_c_hemodinamica USING btree (nr_atendimento);


--
-- Name: idx_bi_conv_amb_c_laboratorio_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_conv_amb_c_laboratorio_lookup ON public.bi_conv_amb_c_laboratorio USING btree (nr_atendimento);


--
-- Name: idx_bi_conv_amb_c_radiologia_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_conv_amb_c_radiologia_lookup ON public.bi_conv_amb_c_radiologia USING btree (nr_sequencia_interno);


--
-- Name: idx_bi_envio_prod_c_envio_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_envio_prod_c_envio_lookup ON public.bi_envio_prod_c_envio USING btree (atendimento);


--
-- Name: idx_bi_envio_prod_c_producao_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_bi_envio_prod_c_producao_lookup ON public.bi_envio_prod_c_producao USING btree (nr_atendimento);


--
-- Name: idx_chamados_data_abertura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_data_abertura ON public.chamados USING btree (data_abertura DESC);


--
-- Name: idx_chamados_locais_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_locais_ativo ON public.chamados_locais USING btree (ativo);


--
-- Name: idx_chamados_locais_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_locais_setor ON public.chamados_locais USING btree (setor);


--
-- Name: idx_chamados_locais_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_chamados_locais_unique ON public.chamados_locais USING btree (lower((setor)::text), lower((local)::text)) WHERE (ativo = true);


--
-- Name: idx_chamados_numero_kora; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_numero_kora ON public.chamados USING btree (numero_kora);


--
-- Name: idx_chamados_problemas_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_chamados_problemas_unique ON public.chamados_problemas USING btree (lower((descricao)::text)) WHERE (ativo = true);


--
-- Name: idx_chamados_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_status ON public.chamados USING btree (status);


--
-- Name: idx_chamados_status_aberto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_status_aberto ON public.chamados USING btree (status) WHERE ((status)::text = ANY (ARRAY[('aberto'::character varying)::text, ('em_atendimento'::character varying)::text]));


--
-- Name: idx_chamados_visualizado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chamados_visualizado ON public.chamados USING btree (visualizado) WHERE (visualizado = false);


--
-- Name: idx_cirurgias_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cirurgias_data ON public.agenda_paciente_cirurgias USING btree (dt_agenda);


--
-- Name: idx_cirurgias_evento_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cirurgias_evento_codigo ON public.agenda_paciente_cirurgias USING btree (evento_codigo);


--
-- Name: idx_cirurgias_medico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cirurgias_medico ON public.agenda_paciente_cirurgias USING btree (nm_medico);


--
-- Name: idx_cirurgias_paciente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cirurgias_paciente ON public.agenda_paciente_cirurgias USING btree (nm_paciente_pf);


--
-- Name: idx_cirurgias_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_cirurgias_status ON public.agenda_paciente_cirurgias USING btree (ie_status_cirurgia);


--
-- Name: idx_data_turno; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_data_turno ON public.evolucao_turno USING btree (data_turno);


--
-- Name: idx_data_turno_completo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_data_turno_completo ON public.evolucao_turno USING btree (data_turno, turno);


--
-- Name: idx_dest_tipo_espec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dest_tipo_espec ON public.notificacoes_destinatarios USING btree (tipo_evento, especialidade) WHERE (ativo = true);


--
-- Name: idx_dt_carga_medicos_ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dt_carga_medicos_ps ON public.medicos_ps USING btree (dt_carga);


--
-- Name: idx_evolucao_turno_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_convenio ON public.evolucao_turno USING btree (ds_convenio);


--
-- Name: idx_evolucao_turno_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_data ON public.evolucao_turno USING btree (data_turno DESC);


--
-- Name: idx_evolucao_turno_ordem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_ordem ON public.evolucao_turno USING btree (data_turno DESC, turno, setor);


--
-- Name: idx_evolucao_turno_paciente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_paciente ON public.evolucao_turno USING btree (nm_paciente);


--
-- Name: idx_evolucao_turno_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_setor ON public.evolucao_turno USING btree (setor);


--
-- Name: idx_evolucao_turno_unidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_evolucao_turno_unidade ON public.evolucao_turno USING btree (unidade);


--
-- Name: idx_fat_pred_dt_alvo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fat_pred_dt_alvo ON public.ml_faturamento_predicoes USING btree (dt_alvo);


--
-- Name: idx_fat_pred_modelo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fat_pred_modelo ON public.ml_faturamento_predicoes USING btree (modelo_id);


--
-- Name: idx_fat_pred_segmento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fat_pred_segmento ON public.ml_faturamento_predicoes USING btree (segmento, dt_alvo);


--
-- Name: idx_gestao_tempo_ps_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_gestao_tempo_ps_lookup ON public.gestao_tempo_ps USING btree (nr_atendimento);


--
-- Name: idx_historico_chamado_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_chamado_id ON public.chamados_historico USING btree (chamado_id);


--
-- Name: idx_historico_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_criado ON public.historico_usuarios USING btree (criado_em);


--
-- Name: idx_historico_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_data ON public.chamados_historico USING btree (data_registro DESC);


--
-- Name: idx_historico_dt_envio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_dt_envio ON public.notificacoes_historico USING btree (dt_envio DESC);


--
-- Name: idx_historico_sucesso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_sucesso ON public.notificacoes_historico USING btree (sucesso);


--
-- Name: idx_historico_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_tipo ON public.notificacoes_historico USING btree (tipo_evento);


--
-- Name: idx_historico_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_historico_usuario ON public.historico_usuarios USING btree (usuario_id);


--
-- Name: idx_imagens_visita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_imagens_visita ON public.sentir_agir_imagens USING btree (visita_id);


--
-- Name: idx_intern_pred_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_intern_pred_dt ON public.ml_internacoes_predicoes USING btree (dt_alvo);


--
-- Name: idx_intern_pred_seg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_intern_pred_seg ON public.ml_internacoes_predicoes USING btree (segmento, dt_alvo);


--
-- Name: idx_itens_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_itens_categoria ON public.sentir_agir_itens USING btree (categoria_id);


--
-- Name: idx_log_acao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_log_acao ON public.sentir_agir_log USING btree (acao);


--
-- Name: idx_log_criado_em; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_log_criado_em ON public.sentir_agir_log USING btree (criado_em);


--
-- Name: idx_log_entidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_log_entidade ON public.sentir_agir_log USING btree (entidade, entidade_id);


--
-- Name: idx_log_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_log_usuario ON public.sentir_agir_log USING btree (usuario);


--
-- Name: idx_logon_time_medicos_ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_logon_time_medicos_ps ON public.medicos_ps USING btree (logon_time);


--
-- Name: idx_mapeamento_cd_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_mapeamento_cd_setor ON public.sentir_agir_setor_mapeamento USING btree (cd_setor_ocupacao);


--
-- Name: idx_ml_faturamento_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_atendimento ON public.ml_faturamento USING btree (nr_atendimento);


--
-- Name: idx_ml_faturamento_dt_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_dt_clinica ON public.ml_faturamento USING btree (dt_entrada, ds_clinica);


--
-- Name: idx_ml_faturamento_dt_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_dt_convenio ON public.ml_faturamento USING btree (dt_entrada, cd_convenio);


--
-- Name: idx_ml_faturamento_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_dt_entrada ON public.ml_faturamento USING btree (dt_entrada);


--
-- Name: idx_ml_faturamento_dt_grupo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_dt_grupo ON public.ml_faturamento USING btree (dt_entrada, grupo_receita);


--
-- Name: idx_ml_faturamento_dt_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_dt_setor ON public.ml_faturamento USING btree (dt_entrada, cd_setor_conta);


--
-- Name: idx_ml_faturamento_tipo_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_faturamento_tipo_atend ON public.ml_faturamento USING btree (dt_entrada, tipo_atendimento);


--
-- Name: idx_ml_intern_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_intern_clinica ON public.ml_internacoes USING btree (dt_entrada, ie_clinica);


--
-- Name: idx_ml_intern_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_intern_convenio ON public.ml_internacoes USING btree (dt_entrada, cd_convenio);


--
-- Name: idx_ml_intern_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_intern_dt_entrada ON public.ml_internacoes USING btree (dt_entrada);


--
-- Name: idx_ml_intern_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_intern_setor ON public.ml_internacoes USING btree (dt_entrada, cd_setor_atendimento);


--
-- Name: idx_ml_metricas_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_metricas_dt ON public.ml_ps_metricas_diarias USING btree (dt_calculo);


--
-- Name: idx_ml_metricas_modelo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_metricas_modelo ON public.ml_ps_metricas_diarias USING btree (modelo_id);


--
-- Name: idx_ml_metricas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_metricas_status ON public.ml_ps_metricas_diarias USING btree (status_saude);


--
-- Name: idx_ml_pred_alvo_modelo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_pred_alvo_modelo ON public.ml_ps_predicoes USING btree (dt_alvo, modelo_id);


--
-- Name: idx_ml_pred_dt_alvo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_pred_dt_alvo ON public.ml_ps_predicoes USING btree (dt_alvo);


--
-- Name: idx_ml_pred_dt_geracao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_pred_dt_geracao ON public.ml_ps_predicoes USING btree (dt_geracao);


--
-- Name: idx_ml_pred_horizonte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_pred_horizonte ON public.ml_ps_predicoes USING btree (horizonte_dias);


--
-- Name: idx_ml_pred_modelo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_pred_modelo ON public.ml_ps_predicoes USING btree (modelo_id);


--
-- Name: idx_ml_ps_ano_mes_dia_hora; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_ano_mes_dia_hora ON public.ml_ps_historico_chegadas USING btree (ano_entrada, mes_entrada, dia_entrada, hora_entrada);


--
-- Name: idx_ml_ps_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_clinica ON public.ml_ps_historico_chegadas USING btree (ds_clinica);


--
-- Name: idx_ml_ps_dia_semana_hora; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_dia_semana_hora ON public.ml_ps_historico_chegadas USING btree (dia_semana, hora_entrada);


--
-- Name: idx_ml_ps_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_dt_entrada ON public.ml_ps_historico_chegadas USING btree (dt_entrada);


--
-- Name: idx_ml_ps_internado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_internado ON public.ml_ps_historico_chegadas USING btree (ie_internado) WHERE (ie_internado = 'S'::bpchar);


--
-- Name: idx_ml_ps_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_ps_setor ON public.ml_ps_historico_chegadas USING btree (cd_setor_atendimento);


--
-- Name: idx_ml_registry_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_registry_ativo ON public.ml_modelos_registry USING btree (ie_ativo) WHERE (ie_ativo = true);


--
-- Name: idx_ml_registry_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_registry_categoria ON public.ml_modelos_registry USING btree (categoria);


--
-- Name: idx_ml_registry_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ml_registry_status ON public.ml_modelos_registry USING btree (status);


--
-- Name: idx_nm_maq_cliente_medicos_ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nm_maq_cliente_medicos_ps ON public.medicos_ps USING btree (nm_maq_cliente);


--
-- Name: idx_nm_usuario_medicos_ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nm_usuario_medicos_ps ON public.medicos_ps USING btree (nm_usuario);


--
-- Name: idx_notif_log_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_atendimento ON public.notificacoes_log USING btree (nr_atendimento) WHERE (nr_atendimento IS NOT NULL);


--
-- Name: idx_notif_log_chave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_chave ON public.notificacoes_log USING btree (chave_evento);


--
-- Name: idx_notif_log_detectado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_detectado ON public.notificacoes_log USING btree (dt_detectado);


--
-- Name: idx_notif_log_dt_detectado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_dt_detectado ON public.notificacoes_log USING btree (dt_detectado);


--
-- Name: idx_notif_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_status ON public.notificacoes_log USING btree (status);


--
-- Name: idx_notif_log_status_renotif; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_status_renotif ON public.notificacoes_log USING btree (status, dt_ultima_notificacao) WHERE ((status)::text = 'notificado'::text);


--
-- Name: idx_notif_log_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_tipo ON public.notificacoes_log USING btree (tipo_evento);


--
-- Name: idx_notif_log_tipo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_log_tipo_status ON public.notificacoes_log USING btree (tipo_evento, status);


--
-- Name: idx_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nr_atendimento ON public.evolucao_turno USING btree (nr_atendimento);


--
-- Name: idx_nutricao_sol_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nutricao_sol_codigo ON public.nutricao_solicitacoes USING btree (codigo_entrega);


--
-- Name: idx_nutricao_sol_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nutricao_sol_criado ON public.nutricao_solicitacoes USING btree (criado_em);


--
-- Name: idx_nutricao_sol_paciente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nutricao_sol_paciente ON public.nutricao_solicitacoes USING btree (nr_atendimento);


--
-- Name: idx_nutricao_sol_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_nutricao_sol_status ON public.nutricao_solicitacoes USING btree (status);


--
-- Name: idx_ocupacao_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ocupacao_atendimento ON public.ocupacao_hospitalar USING btree (nr_atendimento);


--
-- Name: idx_ocupacao_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ocupacao_carga ON public.ocupacao_hospitalar USING btree (dt_carga);


--
-- Name: idx_ocupacao_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ocupacao_setor ON public.ocupacao_hospitalar USING btree (cd_setor_atendimento);


--
-- Name: idx_ocupacao_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ocupacao_status ON public.ocupacao_hospitalar USING btree (ie_status_unidade);


--
-- Name: idx_ocupacao_status_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ocupacao_status_atendimento ON public.ocupacao_hospitalar USING btree (ie_status_unidade, nr_atendimento);


--
-- Name: idx_p16_atend_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p16_atend_dt_entrada ON public.painel16_atendimentos_dia USING btree (dt_entrada);


--
-- Name: idx_p16_atend_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p16_atend_tipo ON public.painel16_atendimentos_dia USING btree (cd_tipo_atendimento);


--
-- Name: idx_p16_atend_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p16_atend_usuario ON public.painel16_atendimentos_dia USING btree (usuario);


--
-- Name: idx_p16_maq_nm_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p16_maq_nm_usuario ON public.painel16_maquinas_recepcao USING btree (nm_usuario);


--
-- Name: idx_p16_maq_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p16_maq_setor ON public.painel16_maquinas_recepcao USING btree (setor);


--
-- Name: idx_p17_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p17_clinica ON public.painel17_atendimentos_ps USING btree (cd_clinica);


--
-- Name: idx_p17_clinica_atend_med; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p17_clinica_atend_med ON public.painel17_atendimentos_ps USING btree (cd_clinica, dt_inicio_atendimento_med DESC) WHERE (dt_inicio_atendimento_med IS NOT NULL);


--
-- Name: idx_p17_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p17_dt_entrada ON public.painel17_atendimentos_ps USING btree (dt_entrada DESC);


--
-- Name: idx_p17_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_p17_nr_atendimento ON public.painel17_atendimentos_ps USING btree (nr_atendimento);


--
-- Name: idx_p19_cd_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_cd_setor ON public.painel19_radiologia_pendencias USING btree (cd_setor_atendimento);


--
-- Name: idx_p19_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_dt_carga ON public.painel19_radiologia_pendencias USING btree (dt_carga);


--
-- Name: idx_p19_dt_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_dt_pedido ON public.painel19_radiologia_pendencias USING btree (dt_pedido);


--
-- Name: idx_p19_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_nr_atendimento ON public.painel19_radiologia_pendencias USING btree (nr_atendimento);


--
-- Name: idx_p19_prioridade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_prioridade ON public.painel19_radiologia_pendencias USING btree (prioridade_ordem, dt_pedido DESC);


--
-- Name: idx_p19_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p19_status ON public.painel19_radiologia_pendencias USING btree (status_radiologia);


--
-- Name: idx_p20_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p20_dt_carga ON public.painel20_radiologia_ps USING btree (dt_carga);


--
-- Name: idx_p20_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p20_dt_entrada ON public.painel20_radiologia_ps USING btree (dt_entrada);


--
-- Name: idx_p20_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p20_nr_atendimento ON public.painel20_radiologia_ps USING btree (nr_atendimento);


--
-- Name: idx_p20_prioridade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p20_prioridade ON public.painel20_radiologia_ps USING btree (prioridade_ordem, dt_pedido);


--
-- Name: idx_p20_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p20_status ON public.painel20_radiologia_ps USING btree (status_radiologia);


--
-- Name: idx_p21_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_convenio ON public.painel21_contas USING btree (convenio);


--
-- Name: idx_p21_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_dt_carga ON public.painel21_contas USING btree (dt_carga DESC NULLS LAST);


--
-- Name: idx_p21_dt_periodo_inicial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_dt_periodo_inicial ON public.painel21_contas USING btree (dt_periodo_inicial DESC NULLS LAST);


--
-- Name: idx_p21_ie_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_ie_tipo ON public.painel21_contas USING btree (ie_tipo);


--
-- Name: idx_p21_legenda_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_legenda_conta ON public.painel21_contas USING btree (legenda_conta);


--
-- Name: idx_p21_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_nr_atendimento ON public.painel21_contas USING btree (nr_atendimento);


--
-- Name: idx_p21_nr_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_nr_conta ON public.painel21_contas USING btree (nr_conta);


--
-- Name: idx_p21_ordenacao_padrao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_ordenacao_padrao ON public.painel21_contas USING btree (estabelecimento, dt_periodo_inicial DESC NULLS LAST, nr_atendimento);


--
-- Name: idx_p21_status_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_status_conta ON public.painel21_contas USING btree (status_conta);


--
-- Name: idx_p21_status_protocolo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p21_status_protocolo ON public.painel21_contas USING btree (status_protocolo);


--
-- Name: idx_p22_atend_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_atend_tipo ON public.painel22_exames_ps USING btree (nr_atendimento, tipo_exame);


--
-- Name: idx_p22_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_atendimento ON public.painel22_exames_ps USING btree (nr_atendimento);


--
-- Name: idx_p22_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_clinica ON public.painel22_exames_ps USING btree (ds_clinica);


--
-- Name: idx_p22_dt_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_dt_pedido ON public.painel22_exames_ps USING btree (dt_pedido);


--
-- Name: idx_p22_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_status ON public.painel22_exames_ps USING btree (status_exame);


--
-- Name: idx_p22_tipo_exame; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p22_tipo_exame ON public.painel22_exames_ps USING btree (tipo_exame);


--
-- Name: idx_p23_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p23_convenio ON public.painel23_atendimentos_amb USING btree (convenio);


--
-- Name: idx_p23_dt_abertura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p23_dt_abertura ON public.painel23_atendimentos_amb USING btree (dt_abertura_atendimento);


--
-- Name: idx_p23_especialidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p23_especialidade ON public.painel23_atendimentos_amb USING btree (especialidade);


--
-- Name: idx_p23_id_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p23_id_atendimento ON public.painel23_atendimentos_amb USING btree (id_atendimento);


--
-- Name: idx_p23_medico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p23_medico ON public.painel23_atendimentos_amb USING btree (medico);


--
-- Name: idx_p24_consumo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_consumo ON public.painel24_estoque_dia USING btree (consumo_dia);


--
-- Name: idx_p24_dias; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_dias ON public.painel24_estoque_dia USING btree (dias_estoque);


--
-- Name: idx_p24_grupo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_grupo ON public.painel24_estoque_dia USING btree (grupo);


--
-- Name: idx_p24_local; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_local ON public.painel24_estoque_dia USING btree (cd_local_estoque);


--
-- Name: idx_p24_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_material ON public.painel24_estoque_dia USING btree (codigo_material);


--
-- Name: idx_p24_subgrupo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p24_subgrupo ON public.painel24_estoque_dia USING btree (subgrupo);


--
-- Name: idx_p25_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_clinica ON public.painel25_ps_exames_medico USING btree (ds_clinica);


--
-- Name: idx_p25_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_dt_carga ON public.painel25_ps_exames_medico USING btree (dt_carga);


--
-- Name: idx_p25_medico_resp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_medico_resp ON public.painel25_ps_exames_medico USING btree (cd_medico_resp);


--
-- Name: idx_p25_nm_medico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_nm_medico ON public.painel25_ps_exames_medico USING btree (nm_medico_resp);


--
-- Name: idx_p25_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_nr_atendimento ON public.painel25_ps_exames_medico USING btree (nr_atendimento);


--
-- Name: idx_p25_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_status ON public.painel25_ps_exames_medico USING btree (status_exame);


--
-- Name: idx_p25_tipo_exame; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p25_tipo_exame ON public.painel25_ps_exames_medico USING btree (tipo_exame);


--
-- Name: idx_p27_hexm_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_hexm_atend ON public.p27_historico_exames USING btree (nr_atendimento, cd_exame, dt_registro);


--
-- Name: idx_p27_hist_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_hist_atend ON public.p27_historico_sinais USING btree (nr_atendimento, dt_registro);


--
-- Name: idx_p27_lab_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_lab_atend ON public.p27_exames_lab USING btree (nr_atendimento);


--
-- Name: idx_p27_lab_atend_exame; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_lab_atend_exame ON public.p27_exames_lab USING btree (nr_atendimento, cd_exame, rn_recencia);


--
-- Name: idx_p27_lab_exame; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_lab_exame ON public.p27_exames_lab USING btree (cd_exame);


--
-- Name: idx_p27_pac_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_pac_atend ON public.p27_pacientes USING btree (nr_atendimento);


--
-- Name: idx_p27_pac_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_pac_setor ON public.p27_pacientes USING btree (cd_setor_atendimento);


--
-- Name: idx_p27_pac_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p27_pac_status ON public.p27_pacientes USING btree (status_paciente);


--
-- Name: idx_p31_dt_prazo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p31_dt_prazo ON public.painel_plano_terapeutico_enfermagem USING btree (dt_prazo) WHERE (dt_prazo IS NOT NULL);


--
-- Name: idx_p31_nr_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p31_nr_atend ON public.painel_plano_terapeutico_enfermagem USING btree (nr_atendimento);


--
-- Name: idx_p31_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p31_setor ON public.painel_plano_terapeutico_enfermagem USING btree (cd_setor_atendimento);


--
-- Name: idx_p31_setor_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p31_setor_status ON public.painel_plano_terapeutico_enfermagem USING btree (cd_setor_atendimento, ie_status_prazo);


--
-- Name: idx_p31_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p31_status ON public.painel_plano_terapeutico_enfermagem USING btree (ie_status_prazo);


--
-- Name: idx_p33_autcon_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_atendimento ON public.painel33_autorizacoes_convenio USING btree (nr_atendimento);


--
-- Name: idx_p33_autcon_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_convenio ON public.painel33_autorizacoes_convenio USING btree (cd_convenio);


--
-- Name: idx_p33_autcon_ds_estagio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_ds_estagio ON public.painel33_autorizacoes_convenio USING btree (ds_estagio);


--
-- Name: idx_p33_autcon_dt_atualizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_dt_atualizacao ON public.painel33_autorizacoes_convenio USING btree (dt_atualizacao DESC);


--
-- Name: idx_p33_autcon_dt_autorizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_dt_autorizacao ON public.painel33_autorizacoes_convenio USING btree (dt_autorizacao DESC);


--
-- Name: idx_p33_autcon_dt_filtro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_dt_filtro ON public.painel33_autorizacoes_convenio USING btree (dt_autorizacao) WHERE (dt_autorizacao IS NOT NULL);


--
-- Name: idx_p33_autcon_estagio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_estagio ON public.painel33_autorizacoes_convenio USING btree (nr_seq_estagio);


--
-- Name: idx_p33_autcon_paciente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_paciente ON public.painel33_autorizacoes_convenio USING btree (cd_pessoa_fisica);


--
-- Name: idx_p33_autcon_setor_origem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_setor_origem ON public.painel33_autorizacoes_convenio USING btree (cd_setor_origem);


--
-- Name: idx_p33_autcon_tipo_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_tipo_atend ON public.painel33_autorizacoes_convenio USING btree (ds_tipo_atendimento);


--
-- Name: idx_p33_autcon_tipo_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_tipo_autor ON public.painel33_autorizacoes_convenio USING btree (ie_tipo_autorizacao);


--
-- Name: idx_p33_autcon_tipo_guia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_autcon_tipo_guia ON public.painel33_autorizacoes_convenio USING btree (ie_tipo_guia);


--
-- Name: idx_p33_cp_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_cp_atendimento ON public.painel33_contas_paciente USING btree (nr_atendimento);


--
-- Name: idx_p33_cp_dt_filtro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_cp_dt_filtro ON public.painel33_contas_paciente USING btree (nr_atendimento, dt_periodo_inicial DESC) WHERE (COALESCE(ie_cancelamento, 'N'::bpchar) <> 'S'::bpchar);


--
-- Name: idx_p33_cp_dt_inicial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_cp_dt_inicial ON public.painel33_contas_paciente USING btree (dt_periodo_inicial);


--
-- Name: idx_p33_cp_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_cp_periodo ON public.painel33_contas_paciente USING btree (nr_atendimento, dt_periodo_inicial, dt_periodo_final);


--
-- Name: idx_p33_cp_status_acerto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_cp_status_acerto ON public.painel33_contas_paciente USING btree (ie_status_acerto);


--
-- Name: idx_p33_doc_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_doc_autor ON public.painel33_autorizacao_documentos USING btree (nr_sequencia_autor);


--
-- Name: idx_p33_mat_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mat_autor ON public.painel33_autorizacao_materiais USING btree (nr_sequencia_autor);


--
-- Name: idx_p33_mc_atend_mat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mc_atend_mat ON public.painel33_materiais_conta USING btree (nr_atendimento, cd_material);


--
-- Name: idx_p33_mc_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mc_conta ON public.painel33_materiais_conta USING btree (nr_interno_conta);


--
-- Name: idx_p33_mc_conta_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mc_conta_dt ON public.painel33_materiais_conta USING btree (nr_interno_conta, dt_atendimento) WHERE (nr_interno_conta IS NOT NULL);


--
-- Name: idx_p33_mc_mat_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mc_mat_autor ON public.painel33_materiais_conta USING btree (nr_seq_mat_autor) WHERE (nr_seq_mat_autor IS NOT NULL);


--
-- Name: idx_p33_mc_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_mc_material ON public.painel33_materiais_conta USING btree (cd_material);


--
-- Name: idx_p33_pc_atend_proc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_pc_atend_proc ON public.painel33_procedimentos_conta USING btree (nr_atendimento, cd_procedimento, ie_origem_proced);


--
-- Name: idx_p33_pc_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_pc_conta ON public.painel33_procedimentos_conta USING btree (nr_interno_conta);


--
-- Name: idx_p33_pc_conta_dt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_pc_conta_dt ON public.painel33_procedimentos_conta USING btree (nr_interno_conta, dt_procedimento) WHERE (nr_interno_conta IS NOT NULL);


--
-- Name: idx_p33_pc_proc_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_pc_proc_autor ON public.painel33_procedimentos_conta USING btree (nr_seq_proc_autor) WHERE (nr_seq_proc_autor IS NOT NULL);


--
-- Name: idx_p33_pc_procedimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_pc_procedimento ON public.painel33_procedimentos_conta USING btree (cd_procedimento, ie_origem_proced);


--
-- Name: idx_p33_proc_autor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p33_proc_autor ON public.painel33_autorizacao_procedimentos USING btree (nr_sequencia_autor);


--
-- Name: idx_p38_classificacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_classificacao ON public.painel_score_farmaceutico USING btree (ie_classificacao);


--
-- Name: idx_p38_dt_ult_visita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_dt_ult_visita ON public.painel_score_farmaceutico USING btree (dt_ultima_visita) WHERE (dt_ultima_visita IS NOT NULL);


--
-- Name: idx_p38_nr_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_nr_atend ON public.painel_score_farmaceutico USING btree (nr_atendimento);


--
-- Name: idx_p38_pt_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_pt_total ON public.painel_score_farmaceutico USING btree (pt_total DESC);


--
-- Name: idx_p38_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_setor ON public.painel_score_farmaceutico USING btree (cd_setor_atendimento);


--
-- Name: idx_p38_setor_classif; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_setor_classif ON public.painel_score_farmaceutico USING btree (cd_setor_atendimento, ie_classificacao);


--
-- Name: idx_p38_status_visita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p38_status_visita ON public.painel_score_farmaceutico USING btree (ie_status_visita);


--
-- Name: idx_p39_dieta_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p39_dieta_atendimento ON public.painel39_interacoes_dieta USING btree (nr_atendimento) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p39_dieta_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p39_dieta_carga ON public.painel39_interacoes_dieta USING btree (dt_carga DESC) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p39_dieta_dieta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p39_dieta_dieta ON public.painel39_interacoes_dieta USING btree (cd_dieta) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p39_dieta_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p39_dieta_material ON public.painel39_interacoes_dieta USING btree (cd_material) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p39_dieta_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p39_dieta_setor ON public.painel39_interacoes_dieta USING btree (cd_setor_atendimento) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p40_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p40_carga ON public.painel40_requisicoes_urgentes USING btree (dt_carga DESC) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p40_destino; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p40_destino ON public.painel40_requisicoes_urgentes USING btree (cd_local_estoque_destino) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p40_dt_liberacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p40_dt_liberacao ON public.painel40_requisicoes_urgentes USING btree (dt_liberacao DESC) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_p40_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p40_pendentes ON public.painel40_requisicoes_urgentes USING btree (nr_requisicao) WHERE (dt_atendimento IS NULL);


--
-- Name: idx_p40_requisicao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_p40_requisicao ON public.painel40_requisicoes_urgentes USING btree (nr_requisicao) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_atendimento ON public.padioleiro USING btree (nr_atendimento) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_carga ON public.padioleiro USING btree (dt_carga) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_entrada_unidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_entrada_unidade ON public.padioleiro USING btree (dt_entrada_unidade) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_setor ON public.padioleiro USING btree (cd_setor_atendimento) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_status ON public.padioleiro USING btree (ie_status_unidade) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_padioleiro_status_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_padioleiro_status_atendimento ON public.padioleiro USING btree (ie_status_unidade, nr_atendimento) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_painel9_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_clinica ON public.pendencias_lab USING btree (ds_clinica);


--
-- Name: idx_painel9_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_dt_entrada ON public.pendencias_lab USING btree (dt_entrada_unidade);


--
-- Name: idx_painel9_img_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_img_pendentes ON public.pendencias_lab USING btree (img_pendentes) WHERE ((img_pendentes IS NOT NULL) AND (img_pendentes <> ''::text));


--
-- Name: idx_painel9_lab_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_lab_pendentes ON public.pendencias_lab USING btree (lab_pendentes) WHERE ((lab_pendentes IS NOT NULL) AND (lab_pendentes <> ''::text));


--
-- Name: idx_painel9_nm_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_nm_setor ON public.pendencias_lab USING btree (nm_setor);


--
-- Name: idx_painel9_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_setor ON public.pendencias_lab USING btree (cd_setor_atendimento);


--
-- Name: idx_painel9_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel9_status ON public.pendencias_lab USING btree (ie_status_unidade);


--
-- Name: idx_painel_cirurgia_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_atend ON public.painel_cirurgias_hemodinamica USING btree (nr_atendimento);


--
-- Name: idx_painel_cirurgia_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_dt_carga ON public.painel_cirurgias_hemodinamica USING btree (dt_carga);


--
-- Name: idx_painel_cirurgia_dt_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_dt_ref ON public.painel_cirurgias_hemodinamica USING btree (dt_referencia);


--
-- Name: idx_painel_cirurgia_mes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_mes ON public.painel_cirurgias_hemodinamica USING btree (mes_referencia);


--
-- Name: idx_painel_cirurgia_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_setor ON public.painel_cirurgias_hemodinamica USING btree (setor);


--
-- Name: idx_painel_cirurgia_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_cirurgia_status ON public.painel_cirurgias_hemodinamica USING btree (status_cirurgia);


--
-- Name: idx_painel_clinico_convenio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_clinico_convenio ON public.painel_clinico_tasy USING btree (ds_convenio);


--
-- Name: idx_painel_clinico_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_clinico_setor ON public.painel_clinico_tasy USING btree (cd_setor_atendimento);


--
-- Name: idx_painel_clinico_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_clinico_status ON public.painel_clinico_tasy USING btree (ie_status_unidade);


--
-- Name: idx_painel_conversao_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_conversao_dt_carga ON public.painel_ps_conversao_internacao USING btree (dt_carga);


--
-- Name: idx_painel_conversao_internado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_conversao_internado ON public.painel_ps_conversao_internacao USING btree (nr_atendimento_internado);


--
-- Name: idx_painel_conversao_mes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_conversao_mes ON public.painel_ps_conversao_internacao USING btree (mes_referencia);


--
-- Name: idx_painel_conversao_ps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_conversao_ps ON public.painel_ps_conversao_internacao USING btree (nr_atendimento_ps);


--
-- Name: idx_painel_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_dt_entrada ON public.painel_prescricoes_nutricao USING btree (dt_entrada);


--
-- Name: idx_painel_dt_prescricao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_dt_prescricao ON public.painel_prescricoes_nutricao USING btree (dt_prescricao);


--
-- Name: idx_painel_enfermaria_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_atendimento ON public.painel_enfermaria USING btree (nr_atendimento) WHERE (nr_atendimento IS NOT NULL);


--
-- Name: idx_painel_enfermaria_atualizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_atualizacao ON public.painel_enfermaria USING btree (dt_atualizacao);


--
-- Name: idx_painel_enfermaria_dt_previsto_alta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_dt_previsto_alta ON public.painel_enfermaria USING btree (dt_previsto_alta) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_painel_enfermaria_especialidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_especialidade ON public.painel_enfermaria USING btree (especialidade) WITH (fillfactor='100', deduplicate_items='true');


--
-- Name: idx_painel_enfermaria_leito; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_leito ON public.painel_enfermaria USING btree (cd_unidade);


--
-- Name: idx_painel_enfermaria_nm_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_nm_setor ON public.painel_enfermaria USING btree (nm_setor);


--
-- Name: idx_painel_enfermaria_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_score ON public.painel_enfermaria USING btree (score_news) WHERE (score_news > 0);


--
-- Name: idx_painel_enfermaria_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_setor ON public.painel_enfermaria USING btree (cd_setor_atendimento);


--
-- Name: idx_painel_enfermaria_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_enfermaria_status ON public.painel_enfermaria USING btree (ie_status_unidade);


--
-- Name: idx_painel_leito; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_leito ON public.painel_prescricoes_nutricao USING btree (leito);


--
-- Name: idx_painel_nr_prescricao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_nr_prescricao ON public.painel_prescricoes_nutricao USING btree (nr_prescricao);


--
-- Name: idx_painel_producao_atend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_producao_atend ON public.painel_producao_mensal USING btree (nr_atendimento);


--
-- Name: idx_painel_producao_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_producao_conta ON public.painel_producao_mensal USING btree (nr_interno_conta);


--
-- Name: idx_painel_producao_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_producao_dt_carga ON public.painel_producao_mensal USING btree (dt_carga);


--
-- Name: idx_painel_producao_dt_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_producao_dt_conta ON public.painel_producao_mensal USING btree (dt_conta);


--
-- Name: idx_painel_producao_mes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_producao_mes ON public.painel_producao_mensal USING btree (mes_referencia);


--
-- Name: idx_painel_ps_atend_dt_carga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_ps_atend_dt_carga ON public.painel_ps_atendimentos USING btree (dt_carga);


--
-- Name: idx_painel_ps_atend_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_ps_atend_dt_entrada ON public.painel_ps_atendimentos USING btree (dt_entrada);


--
-- Name: idx_painel_ps_atend_mes_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_ps_atend_mes_ref ON public.painel_ps_atendimentos USING btree (mes_referencia);


--
-- Name: idx_painel_ps_atend_nr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_ps_atend_nr ON public.painel_ps_atendimentos USING btree (nr_atendimento);


--
-- Name: idx_painel_ps_atend_pessoa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_ps_atend_pessoa ON public.painel_ps_atendimentos USING btree (cd_pessoa_fisica);


--
-- Name: idx_painel_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_painel_setor ON public.painel_prescricoes_nutricao USING btree (setor);


--
-- Name: idx_pareceres_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pareceres_atendimento ON public.pareceres_pendentes USING btree (nr_atendimento);


--
-- Name: idx_pareceres_especialidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pareceres_especialidade ON public.pareceres_pendentes USING btree (especialidade_destino);


--
-- Name: idx_pareceres_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pareceres_setor ON public.pareceres_pendentes USING btree (nm_setor);


--
-- Name: idx_permissoes_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_permissoes_usuario ON public.permissoes_paineis USING btree (usuario_id);


--
-- Name: idx_ps_analise_clinica; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ps_analise_clinica ON public.painel_ps_analise USING btree (ds_clinica);


--
-- Name: idx_ps_analise_dt_entrada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ps_analise_dt_entrada ON public.painel_ps_analise USING btree (dt_entrada);


--
-- Name: idx_ps_analise_medico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ps_analise_medico ON public.painel_ps_analise USING btree (cd_medico_resp);


--
-- Name: idx_ps_analise_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ps_analise_status ON public.painel_ps_analise USING btree (ie_status_pa);


--
-- Name: idx_resp_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_ativo ON public.sentir_agir_responsaveis USING btree (ativo);


--
-- Name: idx_resp_cat_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_cat_categoria ON public.sentir_agir_responsavel_categorias USING btree (categoria_id);


--
-- Name: idx_resp_cat_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_cat_responsavel ON public.sentir_agir_responsavel_categorias USING btree (responsavel_id);


--
-- Name: idx_resp_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_categoria ON public.sentir_agir_responsaveis USING btree (categoria_id);


--
-- Name: idx_resp_set_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_set_responsavel ON public.sentir_agir_responsavel_setores USING btree (responsavel_id);


--
-- Name: idx_resp_set_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_set_setor ON public.sentir_agir_responsavel_setores USING btree (setor_id);


--
-- Name: idx_resp_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_resp_setor ON public.sentir_agir_responsaveis USING btree (setor_id);


--
-- Name: idx_rondas_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rondas_data ON public.sentir_agir_rondas USING btree (data_ronda);


--
-- Name: idx_rondas_data_dupla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rondas_data_dupla ON public.sentir_agir_rondas USING btree (data_ronda, dupla_id);


--
-- Name: idx_rondas_dupla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rondas_dupla ON public.sentir_agir_rondas USING btree (dupla_id);


--
-- Name: idx_rondas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rondas_status ON public.sentir_agir_rondas USING btree (status);


--
-- Name: idx_sepse_analise_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sepse_analise_ativo ON public.painel_sepse_analise_ia USING btree (ie_ativo) WHERE (ie_ativo = true);


--
-- Name: idx_sepse_analise_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sepse_analise_data ON public.painel_sepse_analise_ia USING btree (data_analise DESC);


--
-- Name: idx_sepse_analise_nivel_risco; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sepse_analise_nivel_risco ON public.painel_sepse_analise_ia USING btree (nivel_risco);


--
-- Name: idx_sepse_analise_nr_atend_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sepse_analise_nr_atend_ativo ON public.painel_sepse_analise_ia USING btree (nr_atendimento, ie_ativo);


--
-- Name: idx_sepse_analise_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sepse_analise_nr_atendimento ON public.painel_sepse_analise_ia USING btree (nr_atendimento);


--
-- Name: idx_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_setor ON public.evolucao_turno USING btree (setor);


--
-- Name: idx_snapshot_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_snapshot_tipo ON public.notificacoes_snapshot USING btree (tipo_snapshot);


--
-- Name: idx_trat_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trat_categoria ON public.sentir_agir_tratativas USING btree (categoria_id);


--
-- Name: idx_trat_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trat_criado ON public.sentir_agir_tratativas USING btree (criado_em DESC);


--
-- Name: idx_trat_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trat_responsavel ON public.sentir_agir_tratativas USING btree (responsavel_id);


--
-- Name: idx_trat_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trat_status ON public.sentir_agir_tratativas USING btree (status);


--
-- Name: idx_trat_visita; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_trat_visita ON public.sentir_agir_tratativas USING btree (visita_id);


--
-- Name: idx_usuarios_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios USING btree (email);


--
-- Name: idx_usuarios_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_usuario ON public.usuarios USING btree (usuario);


--
-- Name: idx_visitas_avaliacao_final; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_avaliacao_final ON public.sentir_agir_visitas USING btree (avaliacao_final);


--
-- Name: idx_visitas_criado_em; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_criado_em ON public.sentir_agir_visitas USING btree (criado_em);


--
-- Name: idx_visitas_leito; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_leito ON public.sentir_agir_visitas USING btree (leito);


--
-- Name: idx_visitas_nr_atendimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_nr_atendimento ON public.sentir_agir_visitas USING btree (nr_atendimento);


--
-- Name: idx_visitas_nr_atendimento_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_nr_atendimento_criado ON public.sentir_agir_visitas USING btree (nr_atendimento, criado_em DESC);


--
-- Name: idx_visitas_ronda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_ronda ON public.sentir_agir_visitas USING btree (ronda_id);


--
-- Name: idx_visitas_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_setor ON public.sentir_agir_visitas USING btree (setor_id);


--
-- Name: idx_visitas_status_tratativa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_visitas_status_tratativa ON public.sentir_agir_visitas USING btree (status_tratativa);


--
-- Name: uk_dest_tipo_email_espec; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uk_dest_tipo_email_espec ON public.notificacoes_destinatarios USING btree (tipo_evento, email, COALESCE(especialidade, ''::character varying));


--
-- Name: ux_parecer_medicos; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS ux_parecer_medicos ON public.n8n_parecer_medicos USING btree (nr_parecer);


--
-- Name: chamados trg_chamados_historico; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chamados_historico AFTER UPDATE ON public.chamados FOR EACH ROW EXECUTE FUNCTION public.fn_chamados_registrar_historico();


--
-- Name: chamados_locais trg_chamados_locais_atualizar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chamados_locais_atualizar BEFORE UPDATE ON public.chamados_locais FOR EACH ROW EXECUTE FUNCTION public.fn_chamados_locais_atualizar();


--
-- Name: chamados_problemas trg_chamados_problemas_atualizar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chamados_problemas_atualizar BEFORE UPDATE ON public.chamados_problemas FOR EACH ROW EXECUTE FUNCTION public.fn_chamados_problemas_atualizar();


--
-- Name: chamados trg_chamados_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chamados_timestamp BEFORE UPDATE ON public.chamados FOR EACH ROW EXECUTE FUNCTION public.fn_chamados_atualizar_timestamp();


--
-- Name: painel_enfermaria trg_painel_enfermaria_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_painel_enfermaria_update BEFORE UPDATE ON public.painel_enfermaria FOR EACH ROW EXECUTE FUNCTION public.update_painel_enfermaria_timestamp();


--
-- Name: pendencias_lab trg_update_dt_atualizacao; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_dt_atualizacao BEFORE UPDATE ON public.pendencias_lab FOR EACH ROW EXECUTE FUNCTION public.update_dt_atualizacao();


--
-- Name: painel_sepse_analise_ia trigger_atualizar_dt_sepse; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_atualizar_dt_sepse BEFORE UPDATE ON public.painel_sepse_analise_ia FOR EACH ROW EXECUTE FUNCTION public.atualizar_dt_atualizacao_sepse();


--
-- Name: chamados_historico chamados_historico_chamado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados_historico
    ADD CONSTRAINT chamados_historico_chamado_id_fkey FOREIGN KEY (chamado_id) REFERENCES public.chamados(id);


--
-- Name: chamados chamados_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados
    ADD CONSTRAINT chamados_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.chamados_locais(id);


--
-- Name: chamados chamados_problema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chamados
    ADD CONSTRAINT chamados_problema_id_fkey FOREIGN KEY (problema_id) REFERENCES public.chamados_problemas(id);


--
-- Name: historico_usuarios historico_usuarios_realizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historico_usuarios
    ADD CONSTRAINT historico_usuarios_realizado_por_fkey FOREIGN KEY (realizado_por) REFERENCES public.usuarios(id);


--
-- Name: ml_faturamento_predicoes ml_faturamento_predicoes_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_faturamento_predicoes
    ADD CONSTRAINT ml_faturamento_predicoes_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.ml_modelos_registry(id);


--
-- Name: ml_ps_metricas_diarias ml_ps_metricas_diarias_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_metricas_diarias
    ADD CONSTRAINT ml_ps_metricas_diarias_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.ml_modelos_registry(id);


--
-- Name: ml_ps_predicoes ml_ps_predicoes_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ps_predicoes
    ADD CONSTRAINT ml_ps_predicoes_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.ml_modelos_registry(id);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_refeicao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_refeicao_id_fkey FOREIGN KEY (refeicao_id) REFERENCES public.nutricao_refeicoes(id);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.nutricao_cadastros(id);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES public.usuarios(id);


--
-- Name: nutricao_solicitacoes nutricao_solicitacoes_tipo_dieta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nutricao_solicitacoes
    ADD CONSTRAINT nutricao_solicitacoes_tipo_dieta_id_fkey FOREIGN KEY (tipo_dieta_id) REFERENCES public.nutricao_tipos_dieta(id);


--
-- Name: padioleiro_chamados padioleiro_chamados_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_chamados
    ADD CONSTRAINT padioleiro_chamados_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES public.usuarios(id);


--
-- Name: padioleiro_destinos padioleiro_destinos_tipo_movimento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.padioleiro_destinos
    ADD CONSTRAINT padioleiro_destinos_tipo_movimento_id_fkey FOREIGN KEY (tipo_movimento_id) REFERENCES public.padioleiro_tipos_movimento(id);


--
-- Name: sentir_agir_avaliacoes sentir_agir_avaliacoes_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_avaliacoes
    ADD CONSTRAINT sentir_agir_avaliacoes_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.sentir_agir_itens(id);


--
-- Name: sentir_agir_avaliacoes sentir_agir_avaliacoes_visita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_avaliacoes
    ADD CONSTRAINT sentir_agir_avaliacoes_visita_id_fkey FOREIGN KEY (visita_id) REFERENCES public.sentir_agir_visitas(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_imagens sentir_agir_imagens_visita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_imagens
    ADD CONSTRAINT sentir_agir_imagens_visita_id_fkey FOREIGN KEY (visita_id) REFERENCES public.sentir_agir_visitas(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_itens sentir_agir_itens_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_itens
    ADD CONSTRAINT sentir_agir_itens_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.sentir_agir_categorias(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_responsaveis sentir_agir_responsaveis_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsaveis
    ADD CONSTRAINT sentir_agir_responsaveis_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.sentir_agir_categorias(id);


--
-- Name: sentir_agir_responsaveis sentir_agir_responsaveis_setor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsaveis
    ADD CONSTRAINT sentir_agir_responsaveis_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.sentir_agir_setores(id);


--
-- Name: sentir_agir_responsavel_categorias sentir_agir_responsavel_categorias_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_categorias
    ADD CONSTRAINT sentir_agir_responsavel_categorias_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.sentir_agir_categorias(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_responsavel_categorias sentir_agir_responsavel_categorias_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_categorias
    ADD CONSTRAINT sentir_agir_responsavel_categorias_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.sentir_agir_responsaveis(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_responsavel_setores sentir_agir_responsavel_setores_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_setores
    ADD CONSTRAINT sentir_agir_responsavel_setores_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.sentir_agir_responsaveis(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_responsavel_setores sentir_agir_responsavel_setores_setor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_responsavel_setores
    ADD CONSTRAINT sentir_agir_responsavel_setores_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.sentir_agir_setores(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_rondas sentir_agir_rondas_dupla_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_rondas
    ADD CONSTRAINT sentir_agir_rondas_dupla_id_fkey FOREIGN KEY (dupla_id) REFERENCES public.sentir_agir_duplas(id);


--
-- Name: sentir_agir_setor_mapeamento sentir_agir_setor_mapeamento_setor_sa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_setor_mapeamento
    ADD CONSTRAINT sentir_agir_setor_mapeamento_setor_sa_id_fkey FOREIGN KEY (setor_sa_id) REFERENCES public.sentir_agir_setores(id);


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_avaliacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_avaliacao_id_fkey FOREIGN KEY (avaliacao_id) REFERENCES public.sentir_agir_avaliacoes(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.sentir_agir_categorias(id);


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.sentir_agir_itens(id);


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.sentir_agir_responsaveis(id);


--
-- Name: sentir_agir_tratativas sentir_agir_tratativas_visita_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_tratativas
    ADD CONSTRAINT sentir_agir_tratativas_visita_id_fkey FOREIGN KEY (visita_id) REFERENCES public.sentir_agir_visitas(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_visitas sentir_agir_visitas_ronda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_visitas
    ADD CONSTRAINT sentir_agir_visitas_ronda_id_fkey FOREIGN KEY (ronda_id) REFERENCES public.sentir_agir_rondas(id) ON DELETE CASCADE;


--
-- Name: sentir_agir_visitas sentir_agir_visitas_setor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentir_agir_visitas
    ADD CONSTRAINT sentir_agir_visitas_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.sentir_agir_setores(id);


--
-- Name: usuarios usuarios_atualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES public.usuarios(id);


--
-- PostgreSQL database dump complete
--
