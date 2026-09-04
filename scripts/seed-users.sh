#!/bin/bash
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO users (id, name, api_key_hash) VALUES ('pascal', 'Pascal', 'sharedsecret'), ('claudia', 'Claudia', 'sharedsecret');"
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO settings (user_id, target_budget, currency) VALUES ('pascal', 250000, 'CHF');"
wrangler d1 execute expenses-db --local --command "INSERT OR IGNORE INTO settings (user_id, target_budget, currency) VALUES ('claudia', 250000, 'CHF');"
echo "Users seeded successfully."
