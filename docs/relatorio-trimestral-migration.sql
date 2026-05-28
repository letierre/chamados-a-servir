-- Relatório Trimestral — migration
-- Execute no Supabase SQL Editor

-- 1. Cabeçalho do relatório (um por trimestre)
CREATE TABLE IF NOT EXISTS quarterly_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year         int  NOT NULL,
  quarter      int  NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  stake_name   text NOT NULL DEFAULT '',
  stake_id     text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'extracted'
               CHECK (status IN ('extracted', 'confirmed')),
  uploaded_by  uuid REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, quarter)
);

-- 2. Indicadores por unidade (26 × 8 alas + linha __stake__ por indicador)
CREATE TABLE IF NOT EXISTS quarterly_report_indicators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        uuid NOT NULL REFERENCES quarterly_reports(id) ON DELETE CASCADE,
  ward_id          uuid REFERENCES wards(id),
  ward_name        text NOT NULL,          -- '__stake__' para totais da estaca
  indicator_number int  NOT NULL CHECK (indicator_number BETWEEN 1 AND 26),
  indicator_name   text NOT NULL,
  value            int,                    -- valor por ala (null para linha __stake__)
  stake_real       int,                    -- total real da estaca (só em __stake__)
  stake_potential  int,                    -- potencial da estaca (só em __stake__)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, ward_name, indicator_number)
);

-- 3. Conversos nominais com link opcional para baptism_records
CREATE TABLE IF NOT EXISTS quarterly_report_converts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id           uuid NOT NULL REFERENCES quarterly_reports(id) ON DELETE CASCADE,
  ward_id             uuid REFERENCES wards(id),
  ward_name           text NOT NULL,
  name                text NOT NULL,
  gender              text CHECK (gender IN ('M', 'F')),
  age                 int,
  priesthood          text,
  attended_sacrament  boolean,
  has_calling         boolean,
  baptism_record_id   uuid REFERENCES baptism_records(id),  -- preenchido automaticamente quando nome bate
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qrc_baptism_record
  ON quarterly_report_converts(baptism_record_id);

-- RLS
ALTER TABLE quarterly_reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_report_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_report_converts   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qr_select"   ON quarterly_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "qr_insert"   ON quarterly_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "qr_update"   ON quarterly_reports FOR UPDATE TO authenticated USING (true);
CREATE POLICY "qr_delete"   ON quarterly_reports FOR DELETE TO authenticated USING (true);

CREATE POLICY "qri_select"  ON quarterly_report_indicators FOR SELECT TO authenticated USING (true);
CREATE POLICY "qri_insert"  ON quarterly_report_indicators FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "qri_update"  ON quarterly_report_indicators FOR UPDATE TO authenticated USING (true);
CREATE POLICY "qri_delete"  ON quarterly_report_indicators FOR DELETE TO authenticated USING (true);

CREATE POLICY "qrc_select"  ON quarterly_report_converts FOR SELECT TO authenticated USING (true);
CREATE POLICY "qrc_insert"  ON quarterly_report_converts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "qrc_update"  ON quarterly_report_converts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "qrc_delete"  ON quarterly_report_converts FOR DELETE TO authenticated USING (true);
