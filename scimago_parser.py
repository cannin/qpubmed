"""Generate a Scimago SJR mapping from a semicolon-delimited CSV."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Dict, List, Optional

DEFAULT_INPUT_PATH = Path("scimagojr_2024.csv")
DEFAULT_OUTPUT_PATH = Path("scimago.js")
ISSN_DELIMITER = ","
ISSN_PATTERN = re.compile(r"^[0-9]{4}-?[0-9]{3}[0-9Xx]$")


def is_valid_issn(value: str) -> bool:
    """Check whether a value matches an ISSN-like pattern.

    Args:
        value: Candidate ISSN string.

    Returns:
        True if the value looks like an ISSN, otherwise False.
    """
    return bool(ISSN_PATTERN.match(value))


def normalize_issn(value: str) -> str:
    """Normalize an ISSN string while preserving punctuation.

    Args:
        value: Raw ISSN string.

    Returns:
        Normalized ISSN string with punctuation preserved.
    """
    return value.replace(" ", "")


def parse_issns(issn_field: str) -> List[str]:
    """Parse the ISSN field into individual ISSN strings.

    Args:
        issn_field: Raw ISSN field value from the CSV.

    Returns:
        A list of ISSN strings with punctuation preserved.
    """
    if not issn_field:
        return []
    issns = []
    for part in issn_field.split(ISSN_DELIMITER):
        cleaned = part.strip()
        if cleaned and is_valid_issn(cleaned):
            issns.append(normalize_issn(cleaned))
    return issns


def parse_sjr(value: str) -> Optional[int]:
    """Parse the SJR value and round to the nearest integer.

    Args:
        value: Raw SJR field value from the CSV.

    Returns:
        Rounded integer value, or None if empty.
    """
    cleaned = value.strip()
    if not cleaned:
        return None
    cleaned = cleaned.replace(" ", "")
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        numeric = float(cleaned)
    except ValueError:
        return None
    return int(round(numeric))


def load_sjr_map(csv_path: Path) -> Dict[str, int]:
    """Load the SJR mapping from the Scimago CSV file.

    Args:
        csv_path: Path to the Scimago CSV file.

    Returns:
        Mapping of ISSN to SJR (max when duplicated).
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    sjr_map: Dict[str, int] = {}
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        if reader.fieldnames is None:
            raise ValueError("CSV header is missing.")
        if "Issn" not in reader.fieldnames or "SJR" not in reader.fieldnames:
            raise ValueError("CSV header missing required columns: Issn, SJR")

        # Build the ISSN to SJR mapping from the CSV rows.
        for row in reader:
            issn_field = row.get("Issn", "").strip()
            sjr_value = parse_sjr(row.get("SJR", ""))
            if sjr_value is None:
                continue
            for issn in parse_issns(issn_field):
                if issn in sjr_map and sjr_map[issn] != sjr_value:
                    sjr_map[issn] = max(sjr_map[issn], sjr_value)
                else:
                    sjr_map[issn] = sjr_value

    return sjr_map


def write_js_module(sjr_map: Dict[str, int], output_path: Path) -> None:
    """Write the SJR mapping to a JavaScript module.

    Args:
        sjr_map: Mapping of ISSN to SJR.
        output_path: Path to the output JavaScript file.

    Returns:
        None.
    """
    lines = [
        "// Scimago SJR mapping generated from scimagojr_2024.csv.",
        "",
        "export const SCIMAGO_SJR = {",
    ]
    for issn in sorted(sjr_map):
        lines.append(f'    \"{issn}\": {sjr_map[issn]},')
    lines.append("};")
    lines.append("")
    output_path.write_text("\n".join(lines), encoding="utf-8")


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the argument parser for the CLI.

    Args:
        None.

    Returns:
        Configured ArgumentParser instance.
    """
    parser = argparse.ArgumentParser(
        description="Generate scimago.js from scimagojr_2024.csv."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT_PATH,
        help="Path to scimagojr_2024.csv.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Path to write scimago.js.",
    )
    return parser


def main() -> int:
    """Run the Scimago CSV to Python module conversion.

    Args:
        None.

    Returns:
        Exit status code.
    """
    parser = build_arg_parser()
    args = parser.parse_args()

    # Read the CSV and emit the JavaScript module.
    sjr_map = load_sjr_map(args.input)
    write_js_module(sjr_map, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
