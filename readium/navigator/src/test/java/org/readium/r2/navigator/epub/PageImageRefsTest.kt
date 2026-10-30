package org.readium.r2.navigator.epub

import kotlin.test.assertEquals
import org.junit.Test

class PageImageRefsTest {

    private val bookCss = """
        /* #page002 { background-image: url(commented.jpg) } */
        body { margin: 0; }
        #page001 { background-image: url("../images/page001.jpg"); }
        #page002 { background-image: url('../images/page002.jpg'); }
        .spread #page003, .cover { background: url(../images/page003.jpg) no-repeat; }
        div.art.left { background-image: url(../images/left.jpg); }
        @font-face { font-family: X; src: url(../fonts/x.otf); }
        @media screen { #page002 .inset { background-image: url(../images/inset.png); } }
        .missing { background-image: url(data:image/png;base64,AAAA); }
    """.trimIndent()

    @Test
    fun `takes only the rules whose ids and classes are on the page`() {
        val html = """<body><div id="page002" class="page"><p class="inset">Hi</p></div></body>"""

        assertEquals(
            listOf("../images/page002.jpg", "../fonts/x.otf", "../images/inset.png"),
            cssUrlRefsFor(bookCss, html)
        )
    }

    @Test
    fun `matches a rule when any selector of its list matches`() {
        val html = """<body class="cover"><div id="page009"></div></body>"""

        assertEquals(
            listOf("../images/page003.jpg", "../fonts/x.otf"),
            cssUrlRefsFor(bookCss, html)
        )
    }

    @Test
    fun `needs every class of a compound selector`() {
        val leftOnly = """<div class="art"></div>"""
        val both = """<div class="art  left"></div>"""

        assertEquals(listOf("../fonts/x.otf"), cssUrlRefsFor(bookCss, leftOnly))
        assertEquals(listOf("../images/left.jpg", "../fonts/x.otf"), cssUrlRefsFor(bookCss, both))
    }

    @Test
    fun `reads inline url references and skips data urls`() {
        val html = """
            <style>.bg { background: url( "img/a.jpg" ) }</style>
            <div style="background-image:url(img/b.png)"></div>
            <div style="background-image:url('img/a.jpg')"></div>
            <div style="background:url(data:image/gif;base64,R0lG)"></div>
        """.trimIndent()

        assertEquals(listOf("img/a.jpg", "img/b.png"), inlineUrlRefs(html))
    }
}
