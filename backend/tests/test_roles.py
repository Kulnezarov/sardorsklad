import pytest
from fastapi import HTTPException
from types import SimpleNamespace

from dependencies import require_manager_or_admin, require_roles


def test_require_manager_or_admin_allows_manager():
    user = SimpleNamespace(role="manager")
    assert require_manager_or_admin(user) is user


def test_require_manager_or_admin_denies_unknown_role():
    user = SimpleNamespace(role="customer")
    with pytest.raises(HTTPException) as ex:
        require_manager_or_admin(user)
    assert ex.value.status_code == 403


def test_require_roles_admin_only():
    checker = require_roles("admin")
    assert checker(SimpleNamespace(role="admin")).role == "admin"
    with pytest.raises(HTTPException):
        checker(SimpleNamespace(role="manager"))
