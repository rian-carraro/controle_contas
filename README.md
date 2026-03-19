# Controle de Gastos (protótipo)

Este projeto é um protótipo de uma plataforma de controle de gastos implementada apenas com HTML, CSS e JavaScript, usando IndexedDB como armazenamento local no navegador.

Funcionalidades implementadas:
- Cadastro de cartões (nome, cor, dia que abre e fecha a fatura)
- Cadastro de receitas
- Cadastro de despesas, com opção de lançar por cartão e definir número de parcelas — o sistema cria lançamentos mensais e associa cada parcela ao mês de fatura correspondente
- Cadastro de contas fixas
- Visualização de faturas por cartão e mês, marcação de fatura como paga (o que cria um registro que bloqueia lançamentos nessa fatura)
- Exportação CSV de todas as tabelas
- Geração de PDF simples da fatura para um cartão e mês (usa jsPDF)

Como usar
1. Abra `index.html` no navegador (recomendado Chrome ou Firefox).
2. Cadastre seus cartões em "Cartões".
3. Lance receitas e despesas em "Movimentos". Para despesas no cartão com parcelas, escolha o cartão e informe o número de parcelas.
4. Em "Faturas" escolha cartão e mês para visualizar e marcar como paga.
5. Em "Exportar" você pode baixar CSV com todos os dados ou gerar PDF de uma fatura.

Limitações e próximos passos possíveis
- Validações e experiência do usuário podem ser melhoradas.
- Melhor layout responsivo/mobile.
- Implementar pesquisa e filtros avançados.
- Sincronização com servidor / backup.

Tecnologias
- HTML, CSS, JavaScript
- IndexedDB (armazenamento local)
- dayjs (biblioteca de datas)
- jsPDF (geração de PDF)

