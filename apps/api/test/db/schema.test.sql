-- Database integrity tests. Run against a freshly migrated database:
--   psql -v ON_ERROR_STOP=1 -d ebk_test -f test/db/schema.test.sql
-- Each check either succeeds or raises; the script prints "ALL DATABASE TESTS PASSED" at the end.
\set QUIET on
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(stmt TEXT, pattern TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* pattern THEN
      RAISE EXCEPTION 'Expected error matching "%" but got "%" for: %', pattern, SQLERRM, stmt;
    END IF;
    RAISE NOTICE 'ok (rejected): %', left(stmt, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'Expected statement to fail but it succeeded: %', stmt;
END;
$$;

BEGIN;

-- Reference data
INSERT INTO currencies VALUES ('GBP','British pound',2,'£',true), ('ZMW','Zambian kwacha',2,'K',true);
INSERT INTO countries (code,name,currency_code,dial_code,national_number_length,trunk_prefix,can_send,can_receive,payout_methods)
  VALUES ('GB','United Kingdom','GBP','44',10,'0',true,false,'{}'), ('ZM','Zambia','ZMW','260',9,'0',false,true,'{MOBILE_MONEY}');
INSERT INTO mobile_operators (id,country_code,code,name,prefixes) VALUES ('00000000-0000-0000-0000-0000000000a1','ZM','MTN_ZM','MTN MoMo','{96,76}');
INSERT INTO corridors VALUES ('GB-ZM','GB','GBP','ZM','ZMW',10,2000,600,true);
INSERT INTO users (id,email,password_hash) VALUES ('00000000-0000-0000-0000-000000000001','Test@Example.com','x');

SELECT pg_temp.expect_error($$INSERT INTO users (email,password_hash) VALUES ('test@example.COM','y')$$, 'users_email_lower_key');
SELECT pg_temp.expect_error($$INSERT INTO corridors VALUES ('BAD','GB','GBP','ZM','ZMW',100,10,600,true)$$, 'corridors_limits_chk');

-- Beneficiary validation
SELECT pg_temp.expect_error($$INSERT INTO beneficiaries (user_id,full_name,country_code,payout_method,msisdn) VALUES ('00000000-0000-0000-0000-000000000001','A B','ZM','MOBILE_MONEY','260961234567')$$, 'beneficiaries_mobile_money_chk');
SELECT pg_temp.expect_error($$INSERT INTO beneficiaries (user_id,full_name,country_code,payout_method,mobile_operator_id,msisdn) VALUES ('00000000-0000-0000-0000-000000000001','A B','ZM','MOBILE_MONEY','00000000-0000-0000-0000-0000000000a1','+26096')$$, 'beneficiaries_mobile_money_chk');
INSERT INTO beneficiaries (id,user_id,full_name,country_code,payout_method,mobile_operator_id,msisdn)
  VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','Mwila Banda','ZM','MOBILE_MONEY','00000000-0000-0000-0000-0000000000a1','260961234567');
SELECT pg_temp.expect_error($$INSERT INTO beneficiaries (user_id,full_name,country_code,payout_method,mobile_operator_id,msisdn) VALUES ('00000000-0000-0000-0000-000000000001','Dup','ZM','MOBILE_MONEY','00000000-0000-0000-0000-0000000000a1','260961234567')$$, 'beneficiaries_user_msisdn_key');

-- Rates are append-only
INSERT INTO exchange_rates (id,source_currency,destination_currency,rate,kind,source,fetched_at)
  VALUES ('00000000-0000-0000-0000-0000000000c1','GBP','ZMW',33.85,'SANDBOX','test',now());
SELECT pg_temp.expect_error($$UPDATE exchange_rates SET rate = 40$$, 'append-only');
SELECT pg_temp.expect_error($$INSERT INTO exchange_rates (source_currency,destination_currency,rate,kind,source,fetched_at) VALUES ('GBP','ZMW',-1,'LIVE','t',now())$$, 'exchange_rates_rate_check');

INSERT INTO fee_rules (id,code,source_currency,destination_country,payout_method,fixed_fee,percentage_bps)
  VALUES ('00000000-0000-0000-0000-0000000000d1','std','GBP','ZM','MOBILE_MONEY',0.99,100);

-- Quotes: total must equal send + fee
SELECT pg_temp.expect_error($$INSERT INTO quotes (user_id,corridor_id,payout_method,send_amount,fee,total_payable,exchange_rate_id,rate,rate_kind,recipient_amount,fee_rule_id,expires_at) VALUES ('00000000-0000-0000-0000-000000000001','GB-ZM','MOBILE_MONEY',100,1.99,100,'00000000-0000-0000-0000-0000000000c1',33.85,'SANDBOX',3385,'00000000-0000-0000-0000-0000000000d1',now())$$, 'quotes_total_chk');
INSERT INTO quotes (id,user_id,corridor_id,payout_method,send_amount,fee,total_payable,exchange_rate_id,rate,rate_kind,recipient_amount,fee_rule_id,expires_at)
  VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','GB-ZM','MOBILE_MONEY',100,1.99,101.99,'00000000-0000-0000-0000-0000000000c1',33.85,'SANDBOX',3385,'00000000-0000-0000-0000-0000000000d1',now()+interval '10 min');

-- Transfers
INSERT INTO transfers (id,reference,user_id,beneficiary_id,beneficiary_snapshot,quote_id,corridor_id,source_currency,destination_currency,destination_country,send_amount,fee,total_payable,exchange_rate,rate_kind,recipient_amount,payout_method,idempotency_key)
  VALUES ('00000000-0000-0000-0000-0000000000f1','EBK-TEST-0001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','{}','00000000-0000-0000-0000-0000000000e1','GB-ZM','GBP','ZMW','ZM',100,1.99,101.99,33.85,'SANDBOX',3385,'MOBILE_MONEY','idem-1');
SELECT pg_temp.expect_error($$INSERT INTO transfers (reference,user_id,beneficiary_id,beneficiary_snapshot,quote_id,corridor_id,source_currency,destination_currency,destination_country,send_amount,fee,total_payable,exchange_rate,rate_kind,recipient_amount,payout_method,idempotency_key) VALUES ('EBK-TEST-0002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','{}','00000000-0000-0000-0000-0000000000e1','GB-ZM','GBP','ZMW','ZM',100,1.99,101.99,33.85,'SANDBOX',3385,'MOBILE_MONEY','idem-2')$$, 'transfers_quote_id_key');
SELECT pg_temp.expect_error($$UPDATE transfers SET status='COMPLETED', version=version+1 WHERE reference='EBK-TEST-0001'$$, 'invalid transfer transition');
SELECT pg_temp.expect_error($$UPDATE transfers SET status='PENDING_PAYMENT' WHERE reference='EBK-TEST-0001'$$, 'must increment version');
UPDATE transfers SET status='PENDING_PAYMENT', version=version+1 WHERE reference='EBK-TEST-0001';
UPDATE transfers SET status='PAYMENT_RECEIVED', version=version+1 WHERE reference='EBK-TEST-0001';
SELECT pg_temp.expect_error($$UPDATE transfers SET status='FAILED', version=version+1 WHERE reference='EBK-TEST-0001'$$, 'invalid transfer transition');
SELECT pg_temp.expect_error($$UPDATE transfers SET send_amount=50 WHERE reference='EBK-TEST-0001'$$, 'financial terms');
SELECT pg_temp.expect_error($$DELETE FROM transfers WHERE reference='EBK-TEST-0001'$$, 'append-only');

-- Status history is immutable
INSERT INTO transfer_status_history (transfer_id,from_status,to_status,actor_type) VALUES ('00000000-0000-0000-0000-0000000000f1','DRAFT','PENDING_PAYMENT','SYSTEM');
SELECT pg_temp.expect_error($$UPDATE transfer_status_history SET reason='x'$$, 'append-only');
SELECT pg_temp.expect_error($$DELETE FROM transfer_status_history$$, 'append-only');

-- Duplicate-payment prevention
INSERT INTO payment_providers (id,code,name,adapter) VALUES ('00000000-0000-0000-0000-000000000101','SANDBOX_COLLECT','Sandbox','sandbox-collection');
INSERT INTO payment_attempts (transfer_id,provider_id,idempotency_key,status,amount,currency) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000101','pa-1','PENDING',101.99,'GBP');
SELECT pg_temp.expect_error($$INSERT INTO payment_attempts (transfer_id,provider_id,idempotency_key,status,amount,currency) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000101','pa-2','PENDING',101.99,'GBP')$$, 'payment_attempts_one_open_key');
UPDATE payment_attempts SET status='SUCCEEDED' WHERE idempotency_key='pa-1';
INSERT INTO payment_attempts (transfer_id,provider_id,idempotency_key,status,amount,currency) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000101','pa-3','FAILED',101.99,'GBP');
SELECT pg_temp.expect_error($$UPDATE payment_attempts SET status='SUCCEEDED' WHERE idempotency_key='pa-3'$$, 'payment_attempts_one_success_key');

-- Webhook de-duplication
INSERT INTO provider_webhooks (provider_code,event_id,signature_valid,payload) VALUES ('SANDBOX_COLLECT','evt_1',true,'{}');
SELECT pg_temp.expect_error($$INSERT INTO provider_webhooks (provider_code,event_id,signature_valid,payload) VALUES ('SANDBOX_COLLECT','evt_1',true,'{}')$$, 'provider_webhooks_event_key');

-- Refund four-eyes rule
INSERT INTO admin_users (id,email,full_name,password_hash) VALUES ('00000000-0000-0000-0000-000000000201','ops@ebk.test','Ops','x');
SELECT pg_temp.expect_error($$INSERT INTO refunds (transfer_id,payment_attempt_id,amount,currency,includes_fee,reason,requested_by_id,approved_by_id) SELECT '00000000-0000-0000-0000-0000000000f1', id, 100,'GBP',false,'t','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201' FROM payment_attempts WHERE idempotency_key='pa-1'$$, 'refunds_four_eyes_chk');

-- Audit log immutable
INSERT INTO audit_logs (actor_type,action,entity_type) VALUES ('SYSTEM','test','test');
SELECT pg_temp.expect_error($$UPDATE audit_logs SET action='tampered'$$, 'append-only');
SELECT pg_temp.expect_error($$DELETE FROM audit_logs$$, 'append-only');
SELECT pg_temp.expect_error($$TRUNCATE audit_logs$$, 'append-only');

-- Ledger accounts
INSERT INTO financial_accounts (id,code,name,type,currency) VALUES
  ('00000000-0000-0000-0000-000000000301','COLLECTION_CLEARING:SANDBOX_COLLECT:GBP','Clearing','ASSET','GBP'),
  ('00000000-0000-0000-0000-000000000302','CUSTOMER_TRANSFERS:GBP','Customer transfers','LIABILITY','GBP'),
  ('00000000-0000-0000-0000-000000000303','FEE_REVENUE:GBP','Fees','REVENUE','GBP');

COMMIT;

-- Balanced ledger transaction commits.
BEGIN;
INSERT INTO ledger_transactions (id,event_type,transfer_id,idempotency_key) VALUES ('00000000-0000-0000-0000-000000000401','PAYMENT_RECEIVED','00000000-0000-0000-0000-0000000000f1','ledger:pr:1');
INSERT INTO ledger_entries (ledger_transaction_id,account_id,side,amount,currency) VALUES
  ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000301','DEBIT',101.99,'GBP'),
  ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000302','CREDIT',100.00,'GBP'),
  ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000303','CREDIT',1.99,'GBP');
COMMIT;

-- Unbalanced ledger transaction is rejected at COMMIT; append-only on entries.
DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_transactions (id,event_type,idempotency_key) VALUES ('00000000-0000-0000-0000-000000000402','BAD','ledger:bad:1');
    INSERT INTO ledger_entries (ledger_transaction_id,account_id,side,amount,currency) VALUES
      ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000301','DEBIT',10,'GBP'),
      ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000302','CREDIT',9,'GBP');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'unbalanced ledger was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ 'does not balance' THEN RAISE; END IF;
    RAISE NOTICE 'ok (rejected): unbalanced ledger transaction';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_transactions (id,event_type,idempotency_key) VALUES ('00000000-0000-0000-0000-000000000403','BAD','ledger:bad:2');
    INSERT INTO ledger_entries (ledger_transaction_id,account_id,side,amount,currency) VALUES
      ('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000301','DEBIT',10,'ZMW');
    RAISE EXCEPTION 'currency mismatch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ 'does not match account currency' THEN RAISE; END IF;
    RAISE NOTICE 'ok (rejected): ledger currency mismatch';
  END;
END $$;

SELECT pg_temp.expect_error($$UPDATE ledger_entries SET amount = 1$$, 'append-only');
SELECT pg_temp.expect_error($$DELETE FROM ledger_transactions$$, 'append-only');
SELECT pg_temp.expect_error($$INSERT INTO ledger_transactions (event_type,idempotency_key) VALUES ('DUP','ledger:pr:1')$$, 'ledger_transactions_idempotency_key_key');

DO $$
DECLARE bal NUMERIC;
BEGIN
  SELECT sum(CASE WHEN side='DEBIT' THEN amount ELSE -amount END) INTO bal FROM ledger_entries WHERE currency='GBP';
  IF bal <> 0 THEN RAISE EXCEPTION 'trial balance is not zero: %', bal; END IF;
  RAISE NOTICE 'ok: trial balance is zero';
END $$;

\echo ALL DATABASE TESTS PASSED
