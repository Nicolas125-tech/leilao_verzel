from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_auctioneer, require_bidder
from app.core.database import get_db
from app.models.user import User
from app.schemas.lot import (
    AuctioneerDashboardResponse,
    BidderBidsAndWinsResponse,
    MyDisputesResponse,
    PublicReceiptResponse,
)
from app.services.lots import get_my_disputes
from app.services.settlement import (
    get_auctioneer_dashboard,
    get_bidder_bids_and_wins,
    get_public_receipt,
)

router = APIRouter(tags=["settlement"])


@router.get("/receipts/{receipt_code}", response_model=PublicReceiptResponse)
async def fetch_public_receipt(
    receipt_code: str,
    db: AsyncSession = Depends(get_db),
) -> PublicReceiptResponse:
    return await get_public_receipt(db=db, receipt_code=receipt_code)


@router.get("/me/bids-and-wins", response_model=BidderBidsAndWinsResponse)
async def fetch_my_bids_and_wins(
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
) -> BidderBidsAndWinsResponse:
    return await get_bidder_bids_and_wins(db=db, bidder=current_user)


@router.get("/settlement/my-bids", response_model=MyDisputesResponse)
async def fetch_my_bids(
    current_user: User = Depends(require_bidder),
    db: AsyncSession = Depends(get_db),
) -> MyDisputesResponse:
    return await get_my_disputes(db=db, bidder=current_user)


@router.get("/auctioneer/dashboard", response_model=AuctioneerDashboardResponse)
async def fetch_auctioneer_dashboard(
    current_user: User = Depends(require_auctioneer),
    db: AsyncSession = Depends(get_db),
) -> AuctioneerDashboardResponse:
    return await get_auctioneer_dashboard(db=db, auctioneer=current_user)
