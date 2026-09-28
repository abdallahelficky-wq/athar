-- Additive: the meter reading a nozzle showed when it was set up. It becomes the opening reading of
-- the first shift on that nozzle; until now that opening was always 0, so the meter's whole
-- cumulative total was counted as litres sold in the first shift. Existing nozzles default to 0,
-- which is exactly the behaviour they had before.
ALTER TABLE "station_nozzles" ADD COLUMN "initialReading" DECIMAL(18,3) NOT NULL DEFAULT 0;
