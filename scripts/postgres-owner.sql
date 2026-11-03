-- For scripts/check-container.sh. The password is for a container that's thrown away.
CREATE ROLE truman_owner LOGIN CREATEROLE PASSWORD 'owner_password';
CREATE DATABASE truman_study OWNER truman_owner;
