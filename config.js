// =====================================================================
// CONFIGURAÇÃO DO GEOCAMPO STENGEO
// Depois de implantar o Apps Script como "App da Web", cole a URL /exec abaixo.
// (Também é possível informar a URL na tela de login, em "Servidor".)
// =====================================================================
window.GEOCAMPO_CONFIG = {
  API_URL: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT',
  EMPRESA: 'StenGEO',
  NOME_APP: 'GeoCampo StenGEO',

  // Categorias sugeridas para novos projetos (podem ser editadas em cada projeto)
  CATEGORIAS_PADRAO: [
    'Afloramento', 'Ponto de amostragem', 'Sondagem / Furo', 'Poço / Piezômetro',
    'Nascente / Curso d\'água', 'Erosão / Movimento de massa', 'Patologia / Dano',
    'Marco / Vértice', 'Lote / Edificação', 'Ponto de controle (drone)', 'Registro fotográfico', 'Outro'
  ],

  TIPOS_ATIVIDADE: [
    'Trabalho de campo', 'Reconhecimento', 'Coleta de amostras', 'Levantamento topográfico',
    'Voo de drone', 'Vistoria', 'Deslocamento', 'Reunião', 'Escritório', 'Outro'
  ]
};
