import re
message = "Tình hình phân bổ điểm số môn Nhập môn lập trình như thế nào?"
name_candidates = re.findall(r"(?:[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+|$)){2,}", message)
print("name_candidates:", name_candidates)
