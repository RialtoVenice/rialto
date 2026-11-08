export const PRIMARY_ORIGIN = "https://rialto.casa";
/** Rialto on X. Replace with the real profile URL once the account exists. */
export const X_URL = "https://x.com/RialtoVenice";
export const GITHUB_URL = "https://github.com/RialtoVenice/rialto";
/** First-era Rialto token contract, kept for the server-side ledger routes; not shown on the site. */
export const TOKEN_CA = "0xe0fb5d77c627ba9c7950fc0d62d1d96603e7b7c6";
export const TOKEN_EXPLORER = `https://robinhoodchain.blockscout.com/token/${TOKEN_CA}`;
export const TOKEN_CHART = `https://www.geckoterminal.com/robinhood/tokens/${TOKEN_CA}`;
/** Rialto relaunches on Solana. The mint address is published here the day it goes live; empty until then. */
export const SOLANA_MINT = "8h88ucUAF5o6CEr8rphy9rwNPD7gt2qBEmCv81SCpump";
export const SOLANA_EXPLORER_TOKEN = (mint: string) => `https://solscan.io/token/${mint}`;
export const SOLANA_CHART = (mint: string) => `https://www.geckoterminal.com/solana/tokens/${mint}`;
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
export const BURN_TX = "https://robinhoodchain.blockscout.com/tx/0x988886c1644ea44ce69a2e49a3b7d28361c7be0df419c03a9de55ff698d8dbbe";
export const BURN_TX_1 = "https://robinhoodchain.blockscout.com/tx/0x05faafddd6338097a0350459788fbc7078a8601a1faa863d16a3aa36dbeb3032";
export const BUILTINVENICE_SUBMISSION = "https://github.com/veniceai/builtinvenice/issues/173";
