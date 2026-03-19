# 💰 Controle de Contas

<p align="center">
  <img src="https://img.shields.io/badge/status-em%20desenvolvimento-yellow" />
  <img src="https://img.shields.io/badge/version-1.0-blue" />
  <img src="https://img.shields.io/badge/javascript-vanilla-yellow" />
  <img src="https://img.shields.io/badge/storage-IndexedDB-green" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" />
</p>

Aplicação web para gerenciamento financeiro pessoal com foco em controle de cartões de crédito, despesas parceladas e organização de faturas mensais.

🔗 **Acesse o sistema:**  
👉 https://rian-carraro.github.io/controle_contas/

---

## 📌 Sobre o Projeto

O **Controle de Contas** é uma aplicação 100% client-side (frontend puro), desenvolvida para simular um sistema real de gestão financeira pessoal.

Todos os dados são armazenados localmente no navegador utilizando **IndexedDB**, sem necessidade de backend.

---

## ⚙️ Funcionalidades

### 💳 Cartões de Crédito
- Cadastro de cartões com:
  - Nome
  - Cor personalizada
  - Dia de fechamento
  - Dia de vencimento
- Organização de despesas por cartão

---

### 💸 Receitas e Despesas

#### Receitas
- Cadastro de entradas financeiras

#### Despesas
- À vista
- No cartão
- Parceladas:
  - Geração automática de parcelas
  - Distribuição nas faturas corretas

---

### 📊 Faturas
- Visualização por cartão e mês
- Cálculo automático
- Marcação como paga
- Bloqueio de alterações após pagamento

---

### 🧾 Contas Fixas
- Cadastro de despesas recorrentes

---

### 📤 Exportação
- CSV completo
- PDF de faturas

---

## 🧠 Regras de Negócio

- Parcelas são automaticamente distribuídas nas faturas futuras
- Faturas são geradas dinamicamente
- Faturas pagas não podem ser alteradas
- Dados persistem no navegador (IndexedDB)

---

## 🛠️ Tecnologias

- HTML5
- CSS3
- JavaScript (Vanilla)
- IndexedDB
- dayjs
- jsPDF

---

## 🚀 Como Usar

1. Acesse o sistema  
2. Cadastre seus cartões  
3. Adicione receitas e despesas  
4. Visualize faturas por mês  
5. Marque como paga  
6. Exporte dados se necessário  

---

## ⚠️ Limitações

- Sem login/autenticação
- Sem backup automático
- Sem sincronização entre dispositivos
- Dependente do navegador

---

## 🔐 Persistência

- Dados salvos no navegador (IndexedDB)
- Limpar cache = perda de dados

---

## 📱 Compatibilidade

- Google Chrome
- Microsoft Edge
- Mozilla Firefox

---

## 🔮 Melhorias Futuras

- 🔐 Autenticação
- ☁️ Backup em nuvem
- 📊 Dashboard com gráficos
- 📱 Melhor responsividade
- 🔎 Filtros avançados

---

## 📁 Estrutura do Projeto

```bash
controle_contas/
├── index.html
├── /css
├── /js
├── /assets
└── /libs