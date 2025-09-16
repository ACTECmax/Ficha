// Namespace simples pra evitar globals
window.ACTECMAX = window.ACTECMAX || {};

(function () {
  // ======= CONFIG =======
  const GAS_URL = "https://script.google.com/macros/s/AKfycbztt_1LIn_DlLRvsAT7ML55VgT-tVvIHgM9dOHyleiO2zEU6vrQ6DcH64F2p0qTZmuy3g/exec";
  const FORM_SELECTOR = "body"; // ou '#form-root' / '#print-area' se tiver um container
  const PDF_FILENAME_PREFIX = "Ficha_Cadastral_ACTECmax";

  // Força as regras de impressão (@media print) enquanto capturamos a página
  function forcePrintStyles() {
    const style = document.createElement("style");
    style.id = "force-print-emulation";
    style.setAttribute("media", "screen");
    // Esta regra faz todo @media print também valer na tela
    style.textContent = `
      @media screen {
        /* Emular mídia de impressão */
      }
    `;
    document.head.appendChild(style);

    // Truque: clona todas as @media print para aplicar em screen
    try {
      for (const sheet of document.styleSheets) {
        // Alguns styles podem ser CORS-protected; ignore erros
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          let cloned = "";
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule && /print/i.test(rule.media.mediaText)) {
              // Transforma @media print { ... } em regras simples válidas na tela
              for (const r of rule.cssRules) cloned += r.cssText + "\n";
            }
          }
          if (cloned) {
            const extra = document.createElement("style");
            extra.className = "cloned-print-rules";
            extra.textContent = cloned;
            document.head.appendChild(extra);
          }
        } catch (e) {}
      }
    } catch (e) {}

    document.documentElement.setAttribute("data-emulate-print", "1");
  }

  function unforcePrintStyles() {
    document.documentElement.removeAttribute("data-emulate-print");
    const s = document.getElementById("force-print-emulation");
    if (s) s.remove();
    document.querySelectorAll("style.cloned-print-rules").forEach(el => el.remove());
  }

  // Converte Blob -> base64
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Aguarda fontes e imagens carregarem
  async function waitForAssets() {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) {}
    }
    // Pequeno delay para layout estabilizar
    await new Promise(r => setTimeout(r, 150));
  }

  async function buildPdfBlob() {
    // Elemento que representa a "página" (use o container do formulário)
    const el = document.querySelector(FORM_SELECTOR) || document.body;

    // Parâmetros ajustados para A4, respeitando seu CSS de impressão
    const opt = {
      margin:       [10, 10, 10, 10], // mm
      filename:     "temp.pdf",
      image:        { type: "jpeg", quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false, windowWidth: document.documentElement.scrollWidth },
      jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak:    { mode: ["css", "legacy"] } // respeita page-break-* do seu CSS
    };

    // Usa o pipeline do html2pdf, mas intercepta o Blob antes do save()
    const worker = html2pdf().set(opt).from(el);
    const pdfBlob = await new Promise(async (resolve, reject) => {
      try {
        const canvas = await worker.toCanvas();
        const img = await worker.toImg(); // força raster final
        const pdf = await worker.toPdf();
        // html2pdf expõe o objeto jsPDF interno:
        const out = pdf.output("blob");
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });

    return pdfBlob;
  }

  async function postToGAS({ pdfBase64, filename, meta }) {
    // O seu GAS estava reclamando de "PDF vazio/inválido (render_pdf_b64)".
    // Enviaremos com o campo exatamente "render_pdf_b64".
    const payload = {
      render_pdf_b64: pdfBase64,
      filename,
      meta // pode conter dados do cliente (nome, email, etc.)
    };

    const resp = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error("Falha no Apps Script: " + text);
    }
    return await resp.json().catch(() => ({}));
  }

  ACTECMAX.generatePdfAndSend = async function () {
    try {
      // 1) Valide campos obrigatórios aqui (se já tiver, reutilize)
      // validateFormOrThrow();

      // 2) Aplique visual de impressão
      forcePrintStyles();
      await waitForAssets();

      // 3) Gere o PDF exatamente como o “Imprimir”
      const blob = await buildPdfBlob();

      // 4) Converta p/ base64 e envie
      const base64 = await blobToBase64(blob);
      if (!base64 || base64.length < 50) {
        throw new Error("PDF base64 vazio ou muito pequeno.");
      }

      // Monte um nome de arquivo com data e talvez o nome do cliente (se houver campo #cliente_nome)
      const cliente = (document.querySelector("#cliente_nome")?.value || "Cliente").trim().replace(/[^\w\-]+/g, "_");
      const filename = `${PDF_FILENAME_PREFIX}_${cliente}_${new Date().toISOString().slice(0,10)}.pdf`;

      const meta = {
        createdAt: new Date().toISOString(),
        origin: "GitHubPages/Ficha",
        // Adicione aqui IDs/valores úteis do formulário:
        // emailAdmin: document.querySelector("#email_admin")?.value || "",
      };

      const result = await postToGAS({ pdfBase64: base64, filename, meta });

      alert("PDF gerado e enviado com sucesso!");
      console.log("GAS result:", result);
    } catch (err) {
      console.error(err);
      alert("Falha ao gerar/enviar o PDF: " + (err?.message || err));
    } finally {
      // 5) Remova a emulação do print
      unforcePrintStyles();
    }
  };
})();

