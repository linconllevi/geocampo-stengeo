# GeoCampo StenGEO — Caderneta de campo digital

Aplicativo web (PWA) para os trabalhos de campo da StenGEO. Funciona no **celular** (instalável na tela inicial, com uso **offline**) e no **computador** (navegador), com a mesma interface.

## O que o app faz

| Módulo | Recursos |
|---|---|
| **Cadastro e login** | Criação de conta, aprovação pelo administrador, perfis admin/usuário |
| **Projetos** | Criar/editar projetos, cliente, município, RT, equipe (e-mails), categorias próprias |
| **Mapa** | Google Satélite / Híbrido / Esri / OSM, GPS com precisão, coordenadas UTM SIRGAS 2000, download do mapa para uso offline |
| **Feições** | Pontos, linhas e polígonos (desenho, ponto no GPS, gravação de trilha), código automático (P-001, L-001, A-001), categoria, descrição, atributos, tags, fotos, comprimento/área, edição da geometria |
| **Caderneta** | Anotações diárias (data, horário, atividade, equipe, clima, descrição, fotos) + linha do tempo com as feições do dia, relatório em PDF (azul, com logo) |
| **IA (Gemini)** | Melhorar texto, linguagem técnica, organizar em tópicos e resumir — sempre com prévia para revisar antes de aplicar |
| **Arquivos** | Upload por arrastar e soltar, pastas (Vetores, Imagens e Raster, Documentos, Fotos de campo, Outros), download, abrir no mapa |
| **Camadas** | Shapefile (.zip), KML, KMZ, GeoJSON, GPX, CSV (lat/lon) e GeoTIFF (inclusive em UTM), com cor/opacidade |
| **Exportação** | GeoJSON (QGIS), KML (Google Earth), CSV (Excel, com UTM) e ZIP com todas as fotos |

Os dados ficam salvos no aparelho (IndexedDB) e são sincronizados com o servidor quando houver internet (automático a cada 2 min e ao salvar).

## Estrutura

```
index.html, config.js, manifest.webmanifest, sw.js   → app (GitHub Pages)
css/  js/  lib/  img/                                → interface, lógica, bibliotecas, ícones
apps-script/Code.gs                                  → servidor (Google Apps Script)
```

---

## Passo 1 — Servidor (Google Apps Script) na conta StenGEO

1. Entre na conta **StenGEO Company** no Google Drive e crie uma **Planilha Google** chamada `GeoCampo StenGEO - Banco de dados`.
2. Na planilha: **Extensões > Apps Script**. Apague o conteúdo e cole todo o arquivo `apps-script/Code.gs`. Salve.
3. No seletor de funções, escolha **`configurarInicial`** e clique em **Executar**. Autorize as permissões (Planilhas, Drive, e-mail, conexões externas).
   - Isso cria as abas, a pasta **"GeoCampo StenGEO"** no Drive e a chave secreta das sessões.
4. **Configurações do projeto (⚙) > Propriedades do script** — confira/ajuste:
   - `ADMIN_EMAIL` → seu e-mail (essa conta vira **administrador** ao se cadastrar no app)
   - `GEMINI_API_KEY` → chave do [Google AI Studio](https://aistudio.google.com/apikey) (também pode ser cadastrada depois pelo app, em Ajustes > Administração)
   - `GEMINI_MODEL` → `gemini-3.8-flash` (pode trocar por outro modelo)
5. **Implantar > Nova implantação** > tipo **App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Copie a **URL que termina em `/exec`**.

> Ao alterar o `Code.gs` no futuro: **Implantar > Gerenciar implantações > ✏️ > Versão: Nova versão**. Assim a URL continua a mesma.

## Passo 2 — Configurar o app

Abra `config.js` e cole a URL no lugar de `COLE_AQUI_A_URL_DO_APPS_SCRIPT`.
(Também dá para informar a URL na tela de login, em **Servidor**.)

**Logo:** substitua `img/logo.png` pelo logo oficial da StenGEO (PNG, fundo transparente, formato horizontal). Ele aparece no login, no topo do app e no relatório.

## Passo 3 — Publicar no GitHub Pages

1. No GitHub, crie um repositório (ex.: `geocampo-stengeo`).
2. Envie **todo o conteúdo desta pasta** para a raiz do repositório (pelo site: *Add file > Upload files*, arraste os arquivos e pastas; ou via Git:
   ```bash
   git init && git add . && git commit -m "GeoCampo StenGEO"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/geocampo-stengeo.git
   git push -u origin main
   ```
3. **Settings > Pages** > *Source: Deploy from a branch* > Branch **main** / pasta **/(root)** > Save.
4. Em ~1 minuto o app estará em `https://SEU_USUARIO.github.io/geocampo-stengeo/`.

> O repositório pode ser privado apenas em planos pagos do GitHub; em conta gratuita o Pages exige repositório público. Os **dados** não ficam no GitHub (ficam na Planilha/Drive da StenGEO) — só a interface.

## Passo 4 — Primeiro uso

1. Abra o link e vá em **Criar conta** com o e-mail definido em `ADMIN_EMAIL` → você entra como administrador.
2. A equipe cria as contas; você recebe um e-mail e aprova em **Ajustes > Usuários**.
3. Crie um projeto e adicione os e-mails da equipe em **Equipe**.
4. No celular: abra o link no Chrome > menu ⋮ > **Instalar app / Adicionar à tela inicial**.
5. Antes de ir a campo sem sinal: abra o projeto com internet, sincronize e use o botão **⇩ (baixar mapa offline)** na área de trabalho.

## Observações

- **Fotos** são comprimidas (padrão 1920 px) e podem receber carimbo com data, projeto e coordenadas (Ajustes > Fotos). Vão para `Drive > GeoCampo StenGEO > [Projeto] > Fotos de campo`.
- **Arquivos grandes:** o Apps Script aceita envios de até ~35 MB. Ortofotos maiores ficam só no aparelho (aparecem como "só neste aparelho"). Para compartilhar, exporte uma versão reduzida no QGIS (GeoTIFF com compressão JPEG, resolução de 20–50 cm).
- **Shapefile:** compacte `.shp`, `.shx`, `.dbf` e `.prj` em um único `.zip`. A projeção (ex.: SIRGAS 2000 / UTM 20S) é lida do `.prj`.
- **Chave da IA:** a chave do servidor fica oculta para os usuários. Cada aparelho também pode usar uma chave própria (Ajustes > Inteligência artificial).
- **Conflitos:** se duas pessoas editarem o mesmo registro, prevalece a edição mais recente.
- **Atualizações do app:** após enviar novos arquivos ao GitHub, altere `VERSAO` em `sw.js` para os celulares baixarem a nova versão.
