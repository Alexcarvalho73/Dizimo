-- Script PL/SQL para criação da Procedure NotificaServos
-- Objetivo: Identificar servos escalados para o dia seguinte e gerar mensagens de notificação.

CREATE OR REPLACE PROCEDURE NotificaServos AS
    v_data_amanha VARCHAR2(20);
BEGIN
    -- Obter a data de amanhã no formato YYYY-MM-DD (conforme padrão do sistema)
    v_data_amanha := TO_CHAR(SYSDATE + 1, 'YYYY-MM-DD');

    -- Loop pelos servos designados na tabela missa_servos (referenciada como servos_missa)
    FOR r IN (
        SELECT 
            COALESCE(d.apelido, d.nome) as apelido, -- Prioriza o apelido, fallback para o nome completo
            d.telefone,
            m.tipo AS nome_missa,                  -- O campo 'tipo' armazena o nome/descrição da missa (ex: Missa de Domingo)
            m.hora,
            p.nome AS nome_pastoral
        FROM missas m
        JOIN missa_servos ms ON m.id_missa = ms.id_missa
        JOIN dizimistas d ON ms.id_dizimista = d.id_dizimista
        JOIN pastorais p ON ms.id_pastoral = p.id_pastoral
        WHERE m.data_missa = v_data_amanha
          AND m.status = 1    -- Considera apenas missas não canceladas
          AND ms.status = 1   -- Considera apenas escalas ativas
    ) LOOP
        -- Gravação na tabela de mensagens para o robô de WhatsApp
        INSERT INTO mensagens (texto, telefone, status)
        VALUES (
            'Ola querido servo ' || r.apelido || '. Amanhã voce esta designado para servir na missa ' || 
            r.nome_missa || ' no horario das ' || r.hora || ' na pastoral do(a) ' || r.nome_pastoral,
            r.telefone,
            0 -- STATUS 0 = Pendente de envio
        );
    END LOOP;

    -- Confirmar as gravações
    COMMIT;
    
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

-- Opcional: Exemplo de agendamento para rodar todos os dias às 20h
/*
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'JOB_NOTIFICA_SERVOS',
        job_type        => 'STORED_PROCEDURE',
        job_action      => 'NotificaServos',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=DAILY; BYHOUR=20; BYMINUTE=0; BYSECOND=0',
        enabled         => TRUE,
        comments        => 'Envia notificações para servos na noite anterior às missas.'
    );
END;
/
*/
