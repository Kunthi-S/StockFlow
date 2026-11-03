-- 03_stockflow_accounts.sql: one MySQL account per job (run as root)
--   stockflow_admin     runs the 01, 02, 04 scripts; never in .env
--   stockflow_app       the web app for full-access workers
--   stockflow_readonly  the web app for view-only workers (with READ_ONLY=true)

DROP USER IF EXISTS 'stockflow_admin'@'localhost';
DROP USER IF EXISTS 'stockflow_app'@'localhost';
DROP USER IF EXISTS 'stockflow_readonly'@'localhost';

CREATE USER 'stockflow_admin'@'localhost' IDENTIFIED BY 'admin';
CREATE USER 'stockflow_app'@'localhost' IDENTIFIED BY 'app';
CREATE USER 'stockflow_readonly'@'localhost' IDENTIFIED BY 'read';

-- Everything inside the stockflow database (tables, views, routines, triggers)
GRANT ALL PRIVILEGES ON stockflow.* TO 'stockflow_admin'@'localhost';

-- Rows and routines only: no CREATE, DROP or ALTER
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON stockflow.* TO 'stockflow_app'@'localhost';

-- SELECT only: no writes, no EXECUTE (the procedures write)
GRANT SELECT ON stockflow.* TO 'stockflow_readonly'@'localhost';

SHOW GRANTS FOR 'stockflow_admin'@'localhost';
SHOW GRANTS FOR 'stockflow_app'@'localhost';
SHOW GRANTS FOR 'stockflow_readonly'@'localhost';

-- Cut off access:
--   ALTER USER 'stockflow_readonly'@'localhost' ACCOUNT LOCK;
--   DROP USER 'stockflow_readonly'@'localhost';
