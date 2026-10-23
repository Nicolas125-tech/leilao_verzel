import hashlib
from uuid import UUID


def generate_public_code(user_id: str | UUID, role: str) -> str:
    prefix = "LEI" if str(role).upper() == "AUCTIONEER" else "LIC"
    token = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:4].upper()
    return f"{prefix}-{token}"


def mask_name(full_name: str, public_code: str) -> str:
    cleaned = " ".join(full_name.strip().split())
    if not cleaned:
        return public_code

    parts = cleaned.split(" ")
    first = parts[0]
    last = parts[-1] if len(parts) > 1 else ""

    if len(first) <= 2:
        masked_first = f"{first[0]}*" if len(first) == 2 else f"{first}*"
    elif len(first) == 3:
        masked_first = f"{first[0]}*{first[-1]}"
    else:
        masked_first = f"{first[0]}***{first[-1]}"

    if last:
        masked_last = f"{last[0]}."
        return f"{public_code} ({masked_first} {masked_last})"

    return f"{public_code} ({masked_first})"
