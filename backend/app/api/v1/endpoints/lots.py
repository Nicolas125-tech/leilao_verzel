from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_auctioneer, require_bidder
from app.core.database import get_db
from app.models.user import User
from app.schemas.audit import AuditChainResponse
from app.schemas.bid import BidCreateRequest, BidResponse
from app.schemas.lot import LotCreateRequest, LotResponse
from app.services.audit import audit_lot_bid_chain
from app.services.bidding import place_bid
from app.services.lots import cancel_lot, create_lot, get_lot_by_id, list_public_lots

router = APIRouter(prefix="/lots", tags=["lots"])


@router.post("", response_model=LotResponse, status_code=status.HTTP_201_CREATED)
async def create_new_lot(
    payload: LotCreateRequest,
    current_user: User = Depends(require_auctioneer),
    db: AsyncSession = Depends(get_db),
):
    lot = await create_lot(db=db, auctioneer=current_user, payload=payload)
    return LotResponse.model_validate(lot)


@router.get("", response_model=list[LotResponse])
async def get_public_lots(
    status: str | None = Query(default=None, description="Filtro por status: LIVE, SCHEDULED, ENDED"),
    q: str | None = Query(default=None, description="Busca por título, artista ou técnica"),
    db: AsyncSession = Depends(get_db),
):
    lots = await list_public_lots(db=db, status_filter=status, query_text=q)
    return [LotResponse.model_validate(item) for item in lots]


@router.get("/{lot_id}", response_model=LotResponse)
async def get_lot_detail(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    lot = await get_lot_by_id(db=db, lot_id=lot_id)
    return LotResponse.model_validate(lot)


@router.post("/{lot_id}/cancel", response_model=LotResponse)
async def cancel_existing_lot(
    lot_id: UUID,
    current_user: User = Depends(require_auctioneer),
    db: AsyncSession = Depends(get_db),
):
    lot = await cancel_lot(db=db, auctioneer=current_user, lot_id=lot_id)
    return LotResponse.model_validate(lot)


@router.post("/{lot_id}/bids", response_model=BidResponse, status_code=status.HTTP_201_CREATED)
async def submit_bid(
    lot_id: UUID,
    payload: BidCreateRequest,
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
):
    bid = await place_bid(db=db, bidder=current_user, lot_id=lot_id, payload=payload)
    return BidResponse.model_validate(bid)


@router.get("/{lot_id}/audit", response_model=AuditChainResponse)
async def get_lot_audit_chain(
    lot_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AuditChainResponse:
    return await audit_lot_bid_chain(db=db, lot_id=lot_id)
