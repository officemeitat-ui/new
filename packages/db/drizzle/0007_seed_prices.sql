-- Default model prices (USD per million tokens), Anthropic price list as of October 2026.
-- Cache writes are 5-minute writes at 1.25 × input. Add rows with a later valid_from when
-- prices change; costs are always computed with the row valid at the time of the call.
INSERT INTO price_tables (id, model, input_per_m_tok, output_per_m_tok, cache_read_per_m_tok, cache_write_per_m_tok, valid_from, source)
VALUES
  (gen_random_uuid(), 'claude-opus-5-5',   4.000000, 20.000000, 0.200000, 5.000000, '2026-10-01T00:00:00Z', 'Anthropic-Preisliste 2026-10'),
  (gen_random_uuid(), 'claude-sonnet-5-5', 2.000000, 10.000000, 0.200000, 2.500000, '2026-10-01T00:00:00Z', 'Anthropic-Preisliste 2026-10'),
  (gen_random_uuid(), 'claude-haiku-5-5',  0.100000,  0.500000, 0.010000, 0.125000, '2026-10-01T00:00:00Z', 'Anthropic-Preisliste 2026-10')
ON CONFLICT DO NOTHING;
