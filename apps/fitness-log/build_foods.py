"""Builds the Fitness Log's food list from USDA FoodData Central SR Legacy (public domain).

Output: JSON array of [name, kcal, protein_g, carbs_g, fat_g, [[portion label, grams], ...]],
all nutrition values per 100 g.
Usage: python -I build_foods.py <folder with the SR Legacy CSVs> <output.json>
"""
import csv
import json
import re
import sys

src, out_path = sys.argv[1], sys.argv[2]
NUTRIENTS = {"1008": 1, "1003": 2, "1005": 3, "1004": 4}  # kcal, protein, carbs, fat -> column


def rows(name):
    with open(f"{src}/{name}", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def clean(name):
    name = re.sub(r"\s*\((Includes foods for USDA's Food Distribution Program|includes foods for usda's food distribution program)\)", "", name)
    return re.sub(r"\s+", " ", name).strip()


foods = {}
for r in rows("food.csv"):
    foods[r["fdc_id"]] = [clean(r["description"]), None, 0.0, 0.0, 0.0, []]

for r in rows("food_nutrient.csv"):
    col = NUTRIENTS.get(r["nutrient_id"])
    food = foods.get(r["fdc_id"])
    if col and food and r["amount"]:
        food[col] = float(r["amount"])

units = {r["id"]: r["name"] for r in rows("measure_unit.csv")}


def amount_text(a):
    a = float(a)
    for whole, frac in ((0.25, "1/4"), (0.5, "1/2"), (0.75, "3/4"), (0.333, "1/3"), (0.667, "2/3")):
        if abs(a - whole) < 0.01:
            return frac
    return str(int(a)) if a == int(a) else str(round(a, 2))


for r in sorted(rows("food_portion.csv"), key=lambda r: (r["fdc_id"], int(r["seq_num"] or 0))):
    food = foods.get(r["fdc_id"])
    if not food or len(food[5]) >= 6 or not r["gram_weight"]:
        continue
    unit = units.get(r["measure_unit_id"], "")
    unit = "" if unit in ("undetermined", "") else unit
    label = " ".join(x for x in [amount_text(r["amount"] or 1), unit, r["modifier"].strip() or r["portion_description"].strip()] if x)
    grams = round(float(r["gram_weight"]), 1)
    if grams > 0 and label:
        food[5].append([label[:60], grams])

result = []
for f in foods.values():
    if f[1] is None:
        continue  # no calorie value
    result.append([f[0], round(f[1]), round(f[2], 1), round(f[3], 1), round(f[4], 1), f[5]])
result.sort(key=lambda f: f[0].lower())

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
print(len(result), "foods")

