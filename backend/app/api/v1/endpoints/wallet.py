from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_bidder
from app.core.database import get_db
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.wallet import DepositRequest, TransactionResponse, WalletResponse

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("", response_model=WalletResponse)
async def get_wallet(
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
):
    query = await db.execute(select(Wallet).where(Wallet.user_id == current_user.id))
    wallet = query.scalar_one_or_none()
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Carteira nao encontrada para este usuario.",
        )
    return WalletResponse(
        id=wallet.id,
        user_id=wallet.user_id,
        total_balance_cents=wallet.total_balance_cents,
        committed_balance_cents=wallet.committed_balance_cents,
        available_balance_cents=wallet.available_balance_cents,
    )


@router.post("/deposit", response_model=WalletResponse)
async def deposit(
    payload: DepositRequest,
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
):
    query = await db.execute(
        select(Wallet).where(Wallet.user_id == current_user.id).with_for_update()
    )
    wallet = query.scalar_one_or_none()
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Carteira nao encontrada.",
        )

    wallet.total_balance_cents += payload.amount_cents
    description = f"Deposito simulado de R$ {payload.amount_cents / 100:.2f}"

    transaction = WalletTransaction(
        wallet_id=wallet.id,
        user_id=current_user.id,
        type="DEPOSIT",
        amount_cents=payload.amount_cents,
        balance_after_cents=wallet.total_balance_cents,
        committed_after_cents=wallet.committed_balance_cents,
        description=description,
    )

    db.add(transaction)
    await db.commit()
    await db.refresh(wallet)

    return WalletResponse(
        id=wallet.id,
        user_id=wallet.user_id,
        total_balance_cents=wallet.total_balance_cents,
        committed_balance_cents=wallet.committed_balance_cents,
        available_balance_cents=wallet.available_balance_cents,
    )


@router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
):
    query = await db.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == current_user.id)
        .order_by(WalletTransaction.created_at.desc())
    )
    transactions = query.scalars().all()
    return [TransactionResponse.model_validate(tx) for tx in transactions]


wallets_router = APIRouter(prefix="/wallets", tags=["wallet"])
wallets_router.add_api_route("", get_wallet, methods=["GET"], response_model=WalletResponse)
wallets_router.add_api_route("/me", get_wallet, methods=["GET"], response_model=WalletResponse)
wallets_router.add_api_route("/deposit", deposit, methods=["POST"], response_model=WalletResponse)
wallets_router.add_api_route(
    "/transactions",
    list_transactions,
    methods=["GET"],
    response_model=list[TransactionResponse],
)
