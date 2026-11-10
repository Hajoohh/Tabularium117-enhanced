package main

import (
	"bytes"
	"encoding/csv"
	"testing"
)

func TestEncodeGoodsListContainsNamedNonAbstractProducts(t *testing.T) {
	products := []outProduct{
		{GUID: 3, Names: map[string]string{"english": "Semicolon; Good", "german": "Ware; Gut"}},
		{GUID: 0, Names: map[string]string{"english": "(no product)", "german": "(kein Produkt)"}},
		{GUID: 2, Abstract: true, Names: map[string]string{"english": "Market", "german": "Markt"}},
	}
	data, err := encodeGoodsList(products)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		t.Fatal("goods list is missing its UTF-8 BOM for spreadsheet compatibility")
	}
	reader := csv.NewReader(bytes.NewReader(data[3:]))
	reader.Comma = ';'
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{"GUID", "Name (English)", "Name (Deutsch)"},
		{"3", "Semicolon; Good", "Ware; Gut"},
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d CSV rows, want %d: %v", len(rows), len(want), rows)
	}
	for i := range want {
		if len(rows[i]) != len(want[i]) {
			t.Fatalf("row %d = %v, want %v", i, rows[i], want[i])
		}
		for j := range want[i] {
			if rows[i][j] != want[i][j] {
				t.Fatalf("row %d column %d = %q, want %q", i, j, rows[i][j], want[i][j])
			}
		}
	}
}

func TestEncodeGoodsListRequiresBothNames(t *testing.T) {
	_, err := encodeGoodsList([]outProduct{{
		GUID: 42, Names: map[string]string{"english": "Test good"},
	}})
	if err == nil {
		t.Fatal("expected an error for a product without a German name")
	}
}
