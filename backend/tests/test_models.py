import uuid
from app.models.base import Base
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction


def test_models_metadata_registration():
    table_names = set(Base.metadata.tables.keys())
    expected_tables = {
        "users",
        "wallets",
        "wallet_transactions",
        "lots",
        "bids",
        "settlements",
    }
    assert expected_tables.issubset(table_names)


def test_wallet_available_balance_property():
    wallet = Wallet(
        user_id=uuid.uuid4(),
        total_balance_cents=150000,
        committed_balance_cents=45000,
    )
    assert wallet.total_balance_cents == 150000
    assert wallet.committed_balance_cents == 45000
    assert wallet.available_balance_cents == 105000


def test_user_initialization():
    user = User(
        name="Nicolas Brito",
        email="nicolas@verzel.com.br",
        password_hash="hashed_pw",
        role="BIDDER",
        public_code="LIC-48F9",
        masked_name="LIC-48F9 (N***s B.)",
    )
    assert user.role == "BIDDER"
    assert user.public_code == "LIC-48F9"
