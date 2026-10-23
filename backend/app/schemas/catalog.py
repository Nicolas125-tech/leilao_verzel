from typing import Any
from pydantic import BaseModel, ConfigDict


class CatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    external_id: str
    title: str
    artist: str
    date_display: str
    medium_display: str
    image_url: str
    attributes: dict[str, Any]
    source: str
