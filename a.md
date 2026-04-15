Alterações a fazer:
Nova tabela clientes sql
+------------------+---------------+------+-----+-------------------+-----------------------------------------------+
| Field            | Type          | Null | Key | Default           | Extra                                         |
+------------------+---------------+------+-----+-------------------+-----------------------------------------------+
| id               | int           | NO   | PRI | NULL              | auto_increment                                |
| nome             | varchar(255)  | NO   |     | NULL              |                                               |
| numero_documento | varchar(14)   | NO   | UNI | NULL              |                                               |
| client_id        | bigint        | YES  |     | NULL              |                                               |
| pontos           | decimal(10,2) | NO   |     | 0.00              |                                               |
| created_at       | timestamp     | NO   |     | CURRENT_TIMESTAMP | DEFAULT_GENERATED                             |
| updated_at       | timestamp     | NO   |     | CURRENT_TIMESTAMP | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |
| email            | varchar(255)  | YES  |     | NULL              |                                               |
| telefone         | varchar(20)   | YES  |     | NULL              |                                               |
| endereco         | varchar(255)  | YES  |     | NULL              |                                               |
| numero           | varchar(10)   | YES  |     | NULL              |                                               |
| complemento      | varchar(100)  | YES  |     | NULL              |                                               |
| bairro           | varchar(100)  | YES  |     | NULL              |                                               |
| cidade           | varchar(100)  | YES  |     | NULL              |                                               |
| estado           | char(2)       | YES  |     | NULL              |                                               |
| cep              | varchar(9)    | YES  |     | NULL              |                                               |
+------------------+---------------+------+-----+-------------------+-----------------------------------------------+

identificar todas as funções em clienteRepo que precisam ser refatoradas e adcionar os novos campos nas querys, assim como em processarWebhookVendas ~53, adcionar os campos que vem da resposa do bling
{
  "data": {
    "id": 12345678,
    "nome": "Contato",
    "codigo": "ASD001",
    "situacao": "A",
    "numeroDocumento": "12345678910",
    "telefone": "(54) 3333-4444",
    "celular": "(54) 99999-8888",
    "fantasia": "Nome fantasia",
    "tipo": "J",
    "indicadorIe": 1,
    "ie": "123.456.789.101",
    "rg": "1234567890",
    "inscricaoMunicipal": "123456789012",
    "orgaoEmissor": "1234567890",
    "email": "contato@email.com",
    "emailNotaFiscal": "fiscal@email.com",
    "orgaoPublico": "N",
    "endereco": {
      "geral": {
        "endereco": "R. Olavo Bilac",
        "cep": "95702-000",
        "bairro": "Imigrante",
        "municipio": "Bento Gonçalves",
        "uf": "RS",
        "numero": "914",
        "complemento": "Sede 101"
      },
      "cobranca": {
        "endereco": "R. Olavo Bilac",
        "cep": "95702-000",
        "bairro": "Imigrante",
        "municipio": "Bento Gonçalves",
        "uf": "RS",
        "numero": "914",
        "complemento": "Sede 101"
      }
    },
    "vendedor": {
      "id": 12345678
    },
    "dadosAdicionais": {
      "dataNascimento": "1990-08-24",
      "sexo": "M",
      "naturalidade": "Brasileira"
    },
    "financeiro": {
      "limiteCredito": 0,
      "condicaoPagamento": "30",
      "categoria": {
        "id": 12345678
      }
    },
    "pais": {
      "nome": "ESTADOS UNIDOS"
    },
    "tiposContato": [
      {
        "id": 12345678,
        "descricao": "Fornecedor"
      }
    ],
    "pessoasContato": [
      {
        "id": 12345678,
        "descricao": "Fornecedor Fulano"
      }
    ]
  }
}