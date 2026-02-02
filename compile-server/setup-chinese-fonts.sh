#!/bin/bash
# Configure pdflatex + ctex Chinese font mappings
# Map zhmetrics subfonts (unisong/unihei/unikai, etc.) to Arphic fonts

set -e

# Create mapping directory
mkdir -p /usr/local/texlive/texmf-local/fonts/map/dvips/zhfonts

# Generate font mapping file
MAP_FILE="/usr/local/texlive/texmf-local/fonts/map/dvips/zhfonts/zhfonts.map"
echo "% zhfonts.map - Chinese font mapping for pdflatex + ctex" > "$MAP_FILE"
echo "% Maps zhmetrics subfont files to Arphic Type1 fonts" >> "$MAP_FILE"

# Find TeXLive directory
TEXLIVE_DIR=$(find /usr/local/texlive -maxdepth 1 -type d -name "[0-9]*" | head -1)
if [ -z "$TEXLIVE_DIR" ]; then
    echo "Error: TeXLive directory not found"
    exit 1
fi

echo "Found TeXLive at: $TEXLIVE_DIR"

# Map gbsnu fonts (unisong, unisongsl, unifs, unili)
GBSNU_DIR="$TEXLIVE_DIR/texmf-dist/fonts/type1/arphic/gbsnu"
if [ -d "$GBSNU_DIR" ]; then
    for f in "$GBSNU_DIR"/*.pfb; do
        base=$(basename "$f" .pfb)
        code=${base#gbsnu}
        echo "unisong$code <$base.pfb" >> "$MAP_FILE"
        echo "unisongsl$code <$base.pfb" >> "$MAP_FILE"
        echo "unifs$code <$base.pfb" >> "$MAP_FILE"
        echo "unili$code <$base.pfb" >> "$MAP_FILE"
    done
    echo "Generated mappings for gbsnu fonts"
else
    echo "Warning: gbsnu directory not found at $GBSNU_DIR"
fi

# Map gkaiu fonts (unihei, uniheisl, unikai, uniyou)
GKAIU_DIR="$TEXLIVE_DIR/texmf-dist/fonts/type1/arphic/gkaiu"
if [ -d "$GKAIU_DIR" ]; then
    for f in "$GKAIU_DIR"/*.pfb; do
        base=$(basename "$f" .pfb)
        code=${base#gkaiu}
        echo "unihei$code <$base.pfb" >> "$MAP_FILE"
        echo "uniheisl$code <$base.pfb" >> "$MAP_FILE"
        echo "unikai$code <$base.pfb" >> "$MAP_FILE"
        echo "uniyou$code <$base.pfb" >> "$MAP_FILE"
    done
    echo "Generated mappings for gkaiu fonts"
else
    echo "Warning: gkaiu directory not found at $GKAIU_DIR"
fi

# Count mapping entries
MAP_COUNT=$(wc -l < "$MAP_FILE")
echo "Total mapping entries: $MAP_COUNT"

# Update TeX database
echo "Updating TeX database..."
mktexlsr /usr/local/texlive/texmf-local

# Enable font map (via updmap-sys --enable)
echo "Enabling zhfonts.map..."
updmap-sys --enable Map=zhfonts.map

echo "Chinese font configuration completed!"
