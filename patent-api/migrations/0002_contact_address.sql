ALTER TABLE patent_users ADD COLUMN province TEXT;
ALTER TABLE patent_users ADD COLUMN county TEXT;
ALTER TABLE patent_users ADD COLUMN city TEXT;
ALTER TABLE patent_users ADD COLUMN address TEXT;
ALTER TABLE patent_users ADD COLUMN postal_code TEXT;

ALTER TABLE patent_parties ADD COLUMN province TEXT;
ALTER TABLE patent_parties ADD COLUMN county TEXT;
ALTER TABLE patent_parties ADD COLUMN city TEXT;
ALTER TABLE patent_parties ADD COLUMN address TEXT;
ALTER TABLE patent_parties ADD COLUMN postal_code TEXT;
