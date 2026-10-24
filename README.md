# DudinhaNote

Um app de quadros visuais para Windows, feito para uso pessoal sem conta ou sincronização.

## O que já funciona

- Quadros locais, com troca de quadro e renomeação.
- Anotações editáveis, com fundo colorido ou transparente, fontes, tamanho livre, cor do texto, negrito e itálico.
- Checklists com itens marcáveis e editáveis, e cartões de link com fundos coloridos ou transparentes e texto personalizável.
- Linhas com seta que podem ser movidas arrastando o traço, curvadas pelo puxador central e ajustadas pelas pontas.
- Desenho livre no quadro com seis cores, três espessuras de pincel e borracha para apagar traços.
- Visualização ampliada da imagem com duplo clique e navegação pelo quadro segurando o botão direito do mouse.
- Colunas que funcionam como pastas visuais: arraste anotações, checklists, links, imagens, linhas e desenhos para dentro delas; arraste a coluna pelo puxador para movê-la com o conteúdo. Título, fundo e tamanho são personalizáveis.
- Cartões de quadro dentro de outros quadros: cada cartão tem capa quadrada opcional, título editável e abre o quadro filho; os caminhos no topo permitem voltar aos quadros anteriores.
- Redimensionamento de cartões e imagens pelo puxador ou pelos campos de largura e altura; tamanho do texto ajustável em pixels, com opções de título, subtítulo e texto pequeno.
- Tema escuro e cores independentes para cada janela de anotação, incluindo a opção transparente para deixar apenas o texto flutuando.
- Colagem de imagens com `Ctrl+V` ou pelo botão **Colar foto**, exibidas sem fundo ou cartão atrás; arrastar arquivos para o quadro e seleção pelo botão de imagem.
- Posicionamento de cartões por arrastar, redimensionamento de imagens e zoom.
- Arraste um ícone da barra até o quadro para criar o conteúdo exatamente naquele ponto; clique em um ícone para posicioná-lo com um clique, como antes.
- Ferramenta de desenho livre com seis cores, três tamanhos de pincel e borracha para apagar traços; os desenhos também são salvos localmente.
- Desfazer/refazer ações com `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z` ou pelos botões de seta no topo. No quadro, `Ctrl+C` e `Ctrl+V` copiam e duplicam o item selecionado (anotação, checklist, link, imagem, linha ou desenho); a cópia fica disponível durante a sessão e não substitui o conteúdo da área de transferência do Windows. A colagem de imagens externas continua disponível por `Ctrl+V` ou pelo botão **Colar foto**.
- Salvamento automático do conteúdo e dos arquivos de imagem no IndexedDB local.

O app não sincroniza dados nem envia imagens para um servidor. O botão **Colar foto** lê uma imagem copiada diretamente da área de transferência do Windows. Um link só acessa a internet quando você escolhe abri-lo.

## Abrir durante o desenvolvimento

Requer Node.js. Na pasta do projeto:

```powershell
npm install
npm run start
```

## Criar o instalador do Windows

```powershell
npm run build
```

O instalador é criado em `dist\DudinhaNote Setup 1.0.0.exe`.
Uma cópia pronta para compartilhar, com instruções de instalação, fica em `DudinhaNote - Para compartilhar`.

## Armazenamento

Os quadros, capas, imagens e desenhos ficam no armazenamento IndexedDB do perfil local do app Electron neste computador. Limpar os dados do app no Windows também apaga esse conteúdo; faça cópias dos arquivos importantes antes de limpar ou desinstalar dados do perfil.

## Limites desta primeira versão

O editor implementa os cartões e ações principais para um fluxo offline pessoal. O histórico de desfazer/refazer fica em memória durante a sessão e não substitui o salvamento automático local. As linhas ainda não se conectam automaticamente aos cartões; não há sincronização, colaboração ou importação/exportação de quadros.

## Licença

Este projeto está dedicado ao domínio público sob a [CC0 1.0 Universal](./LICENSE). Você pode copiar, modificar, distribuir e usar o projeto, inclusive para fins comerciais, sem pedir autorização. A atribuição não é obrigatória pela CC0, mas dar crédito à autora é sempre bem-vindo.

Crédito à autora é apreciado, mas não é exigido pela CC0.
