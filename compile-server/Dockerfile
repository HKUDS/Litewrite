# Litewrite LaTeX compile service
# TeXLive-based Dockerized compile environment

FROM texlive/texlive:latest

# Use a faster mirror for apt-get (optional)
RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list 2>/dev/null || true

# Install Node.js, Pandoc, LaTeXML, poppler-utils, and CJK fonts
# Install in steps with retries to reduce network flakiness
RUN set -ux; \
    # Update package list (with retries)
    for i in 1 2 3; do \
        apt-get update && break || sleep 5; \
    done; \
    # Install base tools first
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        gnupg \
        && rm -rf /var/lib/apt/lists/* || true; \
    # Install Node.js (with retries)
    for i in 1 2 3; do \
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && break || sleep 10; \
    done; \
    # Update again and install deps (split; tolerate optional failures)
    apt-get update || true; \
    apt-get install -y --no-install-recommends \
        nodejs \
        && rm -rf /var/lib/apt/lists/* || true; \
    # Install other tools (optional)
    apt-get update || true; \
    apt-get install -y --no-install-recommends \
        pandoc \
        poppler-utils \
        || echo "Warning: Some optional packages failed to install"; \
    # Install CJK font support (for ctex and Chinese templates)
    apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        fonts-noto-cjk-extra \
        fonts-wqy-microhei \
        fonts-wqy-zenhei \
        fontconfig \
        || echo "Warning: Some CJK fonts failed to install"; \
    # Update font cache
    fc-cache -fv || true; \
    # latexml may be unavailable in some images; best-effort install
    apt-get install -y --no-install-recommends latexml || echo "Warning: latexml not available"; \
    # Ensure fontconfig is installed
    apt-get install -y --no-install-recommends fontconfig \
        || echo "Warning: fontconfig failed to install"; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* || true

# Configure pdflatex + ctex font mapping
# Map zhmetrics fonts (unisong/unihei/unikai, etc.) to available fonts
COPY setup-chinese-fonts.sh /tmp/
RUN chmod +x /tmp/setup-chinese-fonts.sh && /tmp/setup-chinese-fonts.sh && rm /tmp/setup-chinese-fonts.sh

# Configure fontconfig to detect TeX Live bundled fonts (e.g. Fandol)
# Important for XeLaTeX/LuaLaTeX when compiling CJK documents
RUN mkdir -p /etc/fonts/conf.d && \
    TEXLIVE_YEAR=$(ls /usr/local/texlive/ | grep -E '^[0-9]{4}$' | head -1) && \
    echo "<?xml version=\"1.0\"?>" > /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "<fontconfig>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "  <dir>/usr/local/texlive/${TEXLIVE_YEAR}/texmf-dist/fonts/opentype</dir>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "  <dir>/usr/local/texlive/${TEXLIVE_YEAR}/texmf-dist/fonts/truetype</dir>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "  <dir>/usr/share/texlive/texmf-dist/fonts/opentype</dir>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "  <dir>/usr/share/texlive/texmf-dist/fonts/truetype</dir>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    echo "</fontconfig>" >> /etc/fonts/conf.d/09-texlive-fonts.conf && \
    fc-cache -fv

# Map common Windows fonts to open-source alternatives
# Use <match> rules to replace requested fonts (stronger than <alias>)
# Use mode=\"prepend\" binding=\"strong\" for top priority
RUN echo '<?xml version="1.0"?>' > /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '<fontconfig>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <!-- Times New Roman -> TeX Gyre Termes -->' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <match target="pattern">' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <test qual="any" name="family"><string>Times New Roman</string></test>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <edit name="family" mode="prepend" binding="strong"><string>TeX Gyre Termes</string></edit>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  </match>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <!-- Arial -> TeX Gyre Heros -->' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <match target="pattern">' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <test qual="any" name="family"><string>Arial</string></test>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <edit name="family" mode="prepend" binding="strong"><string>TeX Gyre Heros</string></edit>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  </match>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <!-- Courier New -> TeX Gyre Cursor -->' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  <match target="pattern">' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <test qual="any" name="family"><string>Courier New</string></test>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '    <edit name="family" mode="prepend" binding="strong"><string>TeX Gyre Cursor</string></edit>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '  </match>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    echo '</fontconfig>' >> /etc/fonts/conf.d/00-font-substitutes.conf && \
    # Remove old config files and potentially conflicting aliases
    rm -f /etc/fonts/conf.d/30-font-substitutes.conf && \
    rm -f /etc/fonts/conf.d/*-noto*.conf 2>/dev/null || true && \
    fc-cache -fv && \
    # Refresh XeLaTeX/LuaTeX font cache (luaotfload)
    luaotfload-tool --update --force 2>/dev/null || true

# Create work directory
WORKDIR /app

# Copy package.json
COPY package.json ./

# Install dependencies
RUN npm install

# Copy server code
COPY server.js ./

# Create temp compile directory
RUN mkdir -p /tmp/latex-compile

# Expose port (default 3002; matches docker-compose.yml)
EXPOSE 3002

# Health check (port controlled by PORT env; default 3002)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3002}/health || exit 1

# Start service
CMD ["node", "server.js"]
