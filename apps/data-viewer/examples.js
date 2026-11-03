// Small sample files for "Try an example".
(window.DataViewer = window.DataViewer || {}).EXAMPLES = [
  {
    name: "GitHub Actions workflow (YAML)",
    file: "ci.yml",
    text: `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Install exactly what the lockfile says
      - run: npm ci
      - run: npm test
`
  },
  {
    name: "Docker Compose file (YAML)",
    file: "compose.yaml",
    text: `services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    restart: unless-stopped
    depends_on:
      - api
  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://app@db/app
    restart: on-failure
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
`
  },
  {
    name: "API response (JSON)",
    file: "users.json",
    text: `{"users":[{"id":1,"name":"Ana Lima","email":"ana@example.com","active":true,"plan":"pro"},{"id":2,"name":"Bo Chen","email":"bo@example.com","active":false,"plan":"free"},{"id":3,"name":"Cara Diaz","email":"cara@example.com","active":true,"plan":"team"}],"total":3,"page":1}`
  },
  {
    name: "Spreadsheet export (CSV)",
    file: "orders.csv",
    text: `order,date,customer,items,total
1001,2026-10-01,Ana Lima,3,54.20
1002,2026-10-02,Bo Chen,1,9.99
1003,2026-10-02,"Diaz, Cara",5,120.00
1004,2026-10-04,Ana Lima,2,31.50
`
  }
];
