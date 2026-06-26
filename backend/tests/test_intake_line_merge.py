from services.intake_line_merge import merge_intake_line, merge_intake_lines


def test_merge_preserves_warehouse_image_urls():
    existing = {
        "local_id": "a1",
        "name": "Old",
        "warehouse_image_urls": ["/uploads/intake/a.jpg"],
        "warehouse_synced": True,
        "product_id": 42,
    }
    incoming = {"local_id": "a1", "name": "New"}
    out = merge_intake_line(existing, incoming)
    assert out["name"] == "New"
    assert out["warehouse_image_urls"] == ["/uploads/intake/a.jpg"]
    assert out["warehouse_synced"] is True
    assert out["product_id"] == 42


def test_merge_unions_image_urls():
    existing = {
        "local_id": "a1",
        "warehouse_image_urls": ["/a.jpg"],
    }
    incoming = {
        "local_id": "a1",
        "warehouse_image_urls": ["/b.jpg"],
    }
    out = merge_intake_line(existing, incoming)
    assert out["warehouse_image_urls"] == ["/a.jpg", "/b.jpg"]


def test_merge_lines_by_local_id():
    existing_lines = [
        {
            "local_id": "1",
            "warehouse_image_urls": ["/x.jpg"],
            "warehouse_synced": True,
        },
        {"local_id": "2", "name": "Keep"},
    ]
    incoming_lines = [
        {"local_id": "1", "name": "Updated"},
    ]
    out = merge_intake_lines(existing_lines, incoming_lines)
    assert len(out) == 1
    assert out[0]["name"] == "Updated"
    assert out[0]["warehouse_image_urls"] == ["/x.jpg"]
    assert out[0]["warehouse_synced"] is True


def test_merge_intake_photo_data_union():
    existing = {"local_id": "1", "intake_photo_data": ["data:a"]}
    incoming = {"local_id": "1", "intake_photo_data": ["data:b"]}
    out = merge_intake_line(existing, incoming)
    assert out["intake_photo_data"] == ["data:a", "data:b"]
