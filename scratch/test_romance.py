import sys
import os
sys.path.append('/Users/surabhi/book_recommendation_system/backend')

from recommender import recommend_by_genre, books

print(f"Total books in dataset: {len(books)}")
res = recommend_by_genre("romance", top_n=10)
print(f"Romance results count: {len(res)}")
if res:
    for b in res[:5]:
        print(f"- {b['title']} (Rating: {b['average_rating']}, Count: {b['rating_count']})")
else:
    print("WARNING: No romance books found!")
