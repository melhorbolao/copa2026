-- Relaxa a constraint para permitir champion/runner_up vazios (não selecionados).
-- A regra de negócio (não repetir o mesmo time) só se aplica quando ambos estão preenchidos.
ALTER TABLE tournament_bets DROP CONSTRAINT IF EXISTS champion_ne_runner_up;
ALTER TABLE tournament_bets ADD CONSTRAINT champion_ne_runner_up
  CHECK (champion = '' OR runner_up = '' OR champion <> runner_up);
