-- 03_stockflow_accounts.sql: MySQL accounts (run third, as root)
-- Full-access workers use root; view-only workers use stockflow_viewer
-- with READ_ONLY=true in .env.

DROP USER IF EXISTS 'stockflow_viewer'@'localhost';
CREATE USER 'stockflow_viewer'@'localhost' IDENTIFIED BY 'letmeview';

-- SELECT only: no writes, no EXECUTE (procedures write), no schema changes
GRANT SELECT ON stockflow.* TO 'stockflow_viewer'@'localhost';

SHOW GRANTS FOR 'stockflow_viewer'@'localhost';

-- Cut off access:
--   ALTER USER 'stockflow_viewer'@'localhost' ACCOUNT LOCK;
--   DROP USER 'stockflow_viewer'@'localhost';
