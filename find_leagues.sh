#!/data/data/com.termux/files/usr/bin/bash
KEY="1351e7f36eb1aae54ba434060e85090a"

echo "=== Recherches par nom ==="
for q in "Europa League" "Conference League" "FA Cup" "Copa del Rey" "Coppa Italia" "DFB Pokal" "Coupe de France" "Belgian Pro League" "CAF Confederation Cup" "Copa do Brasil" "Copa Sudamericana" "Liga MX"; do
  echo "--- $q ---"
  curl -s -H "x-apisports-key: $KEY" "https://v3.football.api-sports.io/leagues?search=$(echo $q | sed 's/ /+/g')" | grep -o '"league":{"id":[0-9]*,"name":"[^"]*"' | head -5
done

echo ""
echo "=== Recherches par pays (championnat national) ==="
for c in "Ivory Coast" "Senegal" "Mali" "Niger" "Ghana" "Nigeria" "Algeria" "Tunisia" "South Africa" "Tanzania" "Zambia" "Kenya" "DR Congo" "Argentina" "Japan" "South Korea"; do
  echo "--- $c ---"
  curl -s -H "x-apisports-key: $KEY" "https://v3.football.api-sports.io/leagues?country=$(echo $c | sed 's/ /%20/g')" | grep -o '"league":{"id":[0-9]*,"name":"[^"]*"' | head -8
done
