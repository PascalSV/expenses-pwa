#!/bin/bash
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO users (id, name, api_key_hash) VALUES ('pascal', 'Pascal', '600584e7-5b8a-4b34-bfce-7521504f3cd6'), ('claudia', 'Claudia', 'f7e38161-626c-44ac-9bc9-1c69de3f5b36');"
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO settings (user_id, target_budget, currency) VALUES ('pascal', 250000, 'EUR');"
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO settings (user_id, target_budget, currency) VALUES ('claudia', 250000, 'EUR');"
echo "Users seeded successfully."
