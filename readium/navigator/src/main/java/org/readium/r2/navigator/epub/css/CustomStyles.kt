package org.readium.r2.navigator.epub.css

internal const val DROP_CAPS_STYLE =  """
                <style>
                    /* Normalize drop caps and specialized typography to ensure consistent text flow */
                    p[class*="dropcap"], p[class*="drop-cap"], p[class*="initial"],
                    p.first, p.opening, p.firstpara, p.firstPara, p.first-para,
                    p[class*="first"], p[class*="caps"], p[class*="stuck"],
                    div[class*="initial"], div[class*="dropcap"], div[class*="drop-cap"],
                    span[class*="initial"], span[class*="dropcap"], span[class*="drop-cap"],
                    .stickupcaps, .char-dropcap-DC, .cso_30-DC, .goudy-handtooled-std-dc,
                    p[style*="text-indent: 0"], p[style*="text-indent:0"] {
                        text-indent: 1em !important;
                        padding-left: 0 !important;
                        margin-left: 0 !important;
                    }
                    
                    /* Reset first-letter styling for consistency */
                    p[class*="dropcap"]::first-letter, p[class*="drop-cap"]::first-letter, 
                    p[class*="initial"]::first-letter, p.first::first-letter, 
                    p[class*="caps"]::first-letter, .char-dropcap-DC::first-letter,
                    .stickupcaps::first-letter,
                    p.para-pf.stickupcaps.char-dropcap-DC.cso_30-DC.goudy-handtooled-std-dc::first-letter {
                        font-size: inherit !important;
                        float: none !important;
                        line-height: inherit !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        font-weight: inherit !important;
                        text-transform: none !important;
                    }
                </style>
                """