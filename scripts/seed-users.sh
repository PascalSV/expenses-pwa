#!/bin/bash
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO users (id, name, api_key_hash) VALUES ('pascal', 'Pascal', 'sharedsecret'), ('claudia', 'Claudia', 'sharedsecret');"
wrangler d1 execute expenses-db --local --command "INSERT OR REPLACE INTO settings (id, target_budget, currency) VALUES (1, 250000, 'EUR');"
echo "Users seeded successfully."
