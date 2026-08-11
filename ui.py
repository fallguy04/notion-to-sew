"""Shared presentation helpers.

The house style lives in assets/*.css rather than in inline st.markdown blocks
scattered through Home.py and Kiosk.py, so there is one place to change it and
the two surfaces cannot drift apart.
"""
from pathlib import Path
import streamlit as st

_ASSETS = Path(__file__).parent / "assets"


@st.cache_data
def _read(name: str) -> str:
    try:
        return (_ASSETS / name).read_text(encoding="utf-8")
    except OSError:
        # Styling is never worth a blank page — fall back to stock Streamlit.
        return ""


def inject(kiosk: bool = False) -> None:
    """Applies the house style. Pass kiosk=True on the touch surface."""
    css = _read("styles.css")
    if kiosk:
        css += "\n" + _read("kiosk.css")
    if css:
        st.markdown(f"<style>{css}</style>", unsafe_allow_html=True)


def page_header(icon: str, title: str, subtitle: str = "") -> None:
    """Page title set in type.

    Replaces streamlit_extras.colored_header, which draws a heavy full-bleed
    rule from a fixed palette that cannot follow the theme.
    """
    sub = '<p class="page-head-sub">{}</p>'.format(subtitle) if subtitle else ""
    st.markdown(
        '<div class="page-head">'
        '<div class="page-head-row">'
        '<span class="page-head-icon">{}</span>'
        '<h1 class="page-head-title">{}</h1>'
        "</div>{}</div>".format(icon, title, sub),
        unsafe_allow_html=True,
    )


def wordmark(tag: str = "") -> None:
    """Kiosk header — type and a hairline rather than a slab of colour."""
    st.markdown(
        '<div class="kiosk-head">'
        '<div class="kiosk-word">Notion&nbsp;to&nbsp;<em>Sew</em></div>'
        f'<div class="kiosk-tag">{tag}</div>'
        "</div>",
        unsafe_allow_html=True,
    )
