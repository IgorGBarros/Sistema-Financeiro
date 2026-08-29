/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tokens do sistema visual (padrão Material 3). Todos apontam para
        // variáveis CSS para que o tema escuro seja uma troca de valores, não
        // uma segunda tabela de classes.
        surface: {
          DEFAULT: "var(--surface)",
          bright: "var(--surface-bright)",
          dim: "var(--surface-dim)",
          variant: "var(--surface-variant)",
        },
        "surface-container": {
          lowest: "var(--surface-container-lowest)",
          low: "var(--surface-container-low)",
          DEFAULT: "var(--surface-container)",
          high: "var(--surface-container-high)",
          highest: "var(--surface-container-highest)",
        },
        "on-surface": {
          DEFAULT: "var(--on-surface)",
          variant: "var(--on-surface-variant)",
        },
        outline: {
          DEFAULT: "var(--outline)",
          variant: "var(--outline-variant)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          container: "var(--primary-container)",
        },
        "on-primary": {
          DEFAULT: "var(--on-primary)",
          container: "var(--on-primary-container)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          container: "var(--secondary-container)",
        },
        "on-secondary": {
          DEFAULT: "var(--on-secondary)",
          container: "var(--on-secondary-container)",
        },
        error: {
          DEFAULT: "var(--error)",
          container: "var(--error-container)",
        },
        "on-error": {
          DEFAULT: "var(--on-error)",
          container: "var(--on-error-container)",
        },
        // Receita e despesa são conceito de domínio, não decoração: ficam
        // nomeados para que gráfico, tabela e badge nunca discordem.
        receita: {
          DEFAULT: "var(--receita)",
          surface: "var(--receita-surface)",
          on: "var(--receita-on)",
        },
        despesa: {
          DEFAULT: "var(--despesa)",
          surface: "var(--despesa-surface)",
          on: "var(--despesa-on)",
        },
        // Aliases do shadcn, para os primitivos existentes continuarem valendo.
        background: "var(--surface)",
        foreground: "var(--on-surface)",
        border: "var(--outline-variant)",
        input: "var(--outline-variant)",
        ring: "var(--secondary)",
        card: {
          DEFAULT: "var(--surface-container-lowest)",
          foreground: "var(--on-surface)",
        },
        muted: {
          DEFAULT: "var(--surface-container-low)",
          foreground: "var(--on-surface-variant)",
        },
        accent: {
          DEFAULT: "var(--surface-container-high)",
          foreground: "var(--on-surface)",
        },
        destructive: {
          DEFAULT: "var(--error)",
          foreground: "var(--on-error)",
        },
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "9999px",
      },
      spacing: {
        unit: "4px",
        "stack-sm": "8px",
        "gutter-table": "12px",
        "stack-md": "16px",
        "container-padding": "24px",
        "stack-lg": "32px",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        // Números em coluna precisam alinhar. Fonte tabular resolve de vez.
        mono: ["JetBrains Mono Variable", "ui-monospace", "monospace"],
      },
      fontSize: {
        "data-tabular": ["13px", { lineHeight: "16px", fontWeight: "450" }],
        "body-sm": ["13px", { lineHeight: "18px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "label-caps": [
          "12px",
          { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" },
        ],
        "headline-sm": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "headline-md": [
          "24px",
          { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        "display-lg": [
          "36px",
          { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
      },
      boxShadow: {
        card: "0 10px 15px -3px rgb(0 0 0 / 0.03)",
        panel: "0 10px 15px -3px rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        varredura: {
          "0%": { top: "5%", opacity: "0" },
          "10%, 90%": { opacity: "1" },
          "100%": { top: "95%", opacity: "0" },
        },
      },
      animation: { varredura: "varredura 3s linear infinite" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
