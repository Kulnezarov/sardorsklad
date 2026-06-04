from services.product_search import (
    expand_term_variants,
    fuzzy_score,
    normalize_search_text,
    subsequence_match,
)


def test_normalize_strips_punctuation():
    assert normalize_search_text("Фара R!") == normalize_search_text("фара r")


def test_synonym_martezator():
    variants = expand_term_variants("мартезатор")
    assert "амортизатор" in variants


def test_subsequence_typo():
    assert subsequence_match("мртзтр", "амортизатор передний")


def test_fuzzy_score_high_for_typo():
    score = fuzzy_score("мартезатор", "амортизатор toyota camry")
    assert score >= 0.5
