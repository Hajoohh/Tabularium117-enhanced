// Command gen-goods-chains generates the browser's production-chain catalog
// from the factories in Anno 117 calculator params.js.
//
// Usage:
//
//	go run ./tools/gen-goods-chains --params dist/support_files/params.js [--out web/js/goods-chains.json]
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const jsPrefix = "if(window.params == null)window.params="

type params struct {
	Factories      []factory       `json:"factories"`
	Products       []product       `json:"products"`
	ProductFilters []productFilter `json:"productFilters"`
	Regions        []region        `json:"regions"`
}

type factory struct {
	GUID    int32    `json:"guid"`
	Regions []string `json:"associatedRegions"`
	Inputs  []amount `json:"inputs"`
	Outputs []amount `json:"outputs"`
}

type amount struct {
	Product int32 `json:"product"`
}

type product struct {
	GUID int32 `json:"guid"`
}

type productFilter struct {
	LocaText map[string]string `json:"locaText"`
	Products []int32           `json:"products"`
}

type region struct {
	ID       string            `json:"id"`
	LocaText map[string]string `json:"locaText"`
}

type good struct {
	GUID int32 `json:"guid"`
}

type stage struct {
	Inputs []good `json:"inputs"`
	Output good   `json:"output"`
}

type chain struct {
	Product good    `json:"product"`
	Stages  []stage `json:"stages"`
}

type output struct {
	Regions     map[string][]chain `json:"regions"`
	EndProducts []int32            `json:"endProducts"`
}

type recipe struct {
	Factory int32
	Inputs  []int32
	Output  int32
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "gen-goods-chains:", err)
		os.Exit(1)
	}
}

func run() error {
	paramsPath := flag.String("params", "", "path to params.js")
	outPath := flag.String("out", "web/js/goods-chains.json", "output path")
	flag.Parse()

	if *paramsPath == "" {
		return errors.New("--params is required")
	}
	data, err := os.ReadFile(*paramsPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", *paramsPath, err)
	}
	parsed, err := readParams(data)
	if err != nil {
		return fmt.Errorf("parse %s: %w", *paramsPath, err)
	}
	result, err := generate(parsed)
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("encode output: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.MkdirAll(filepath.Dir(*outPath), 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	if err := os.WriteFile(*outPath, encoded, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", *outPath, err)
	}
	return nil
}

func readParams(data []byte) (*params, error) {
	text := string(data)
	index := strings.Index(text, jsPrefix)
	if index < 0 {
		return nil, fmt.Errorf("expected JavaScript prefix %q", jsPrefix)
	}
	jsonText := strings.TrimSpace(text[index+len(jsPrefix):])
	jsonText = strings.TrimSuffix(jsonText, ";")

	var parsed params
	if err := json.Unmarshal([]byte(jsonText), &parsed); err != nil {
		return nil, fmt.Errorf("decode JSON: %w", err)
	}
	if parsed.Factories == nil || parsed.Products == nil || parsed.ProductFilters == nil || parsed.Regions == nil {
		return nil, errors.New("params.js is missing factories, products, productFilters, or regions")
	}
	return &parsed, nil
}

func generate(input *params) (output, error) {
	productGUIDs := make(map[int32]bool, len(input.Products))
	for _, entry := range input.Products {
		productGUIDs[entry.GUID] = true
	}
	endProducts := make(map[int32]bool)
	foundConsumerFilter := false
	for _, filter := range input.ProductFilters {
		if filter.LocaText["english"] != "Consumer Goods" {
			continue
		}
		foundConsumerFilter = true
		for _, guid := range filter.Products {
			if !productGUIDs[guid] {
				return output{}, fmt.Errorf("Consumer Goods filter references unknown product %d", guid)
			}
			endProducts[guid] = true
		}
	}
	if !foundConsumerFilter {
		return output{}, errors.New("params.js has no Consumer Goods product filter")
	}
	endProductGUIDs := make([]int32, 0, len(endProducts))
	for guid := range endProducts {
		endProductGUIDs = append(endProductGUIDs, guid)
	}
	sort.Slice(endProductGUIDs, func(i, j int) bool { return endProductGUIDs[i] < endProductGUIDs[j] })

	regionNames := make(map[string]string, len(input.Regions))
	for _, entry := range input.Regions {
		if name := entry.LocaText["english"]; entry.ID != "" && name != "" {
			regionNames[entry.ID] = name
		}
	}

	recipesByRegion := make(map[string]map[int32][]recipe)
	for _, building := range input.Factories {
		for _, regionID := range building.Regions {
			regionName, ok := regionNames[regionID]
			if !ok {
				return output{}, fmt.Errorf("factory %d references region %q without an English name", building.GUID, regionID)
			}
			if recipesByRegion[regionName] == nil {
				recipesByRegion[regionName] = make(map[int32][]recipe)
			}
			for _, produced := range building.Outputs {
				if !productGUIDs[produced.Product] {
					return output{}, fmt.Errorf("factory %d outputs unknown product %d", building.GUID, produced.Product)
				}
				current := recipe{Factory: building.GUID, Output: produced.Product}
				for _, consumed := range building.Inputs {
					if !productGUIDs[consumed.Product] {
						return output{}, fmt.Errorf("factory %d consumes unknown product %d", building.GUID, consumed.Product)
					}
					current.Inputs = append(current.Inputs, consumed.Product)
				}
				recipesByRegion[regionName][produced.Product] = append(
					recipesByRegion[regionName][produced.Product], current,
				)
			}
		}
	}

	result := output{
		Regions:     make(map[string][]chain, len(recipesByRegion)),
		EndProducts: endProductGUIDs,
	}
	regionNamesSorted := make([]string, 0, len(recipesByRegion))
	for name := range recipesByRegion {
		regionNamesSorted = append(regionNamesSorted, name)
	}
	sort.Strings(regionNamesSorted)

	for _, regionName := range regionNamesSorted {
		recipes := recipesByRegion[regionName]
		for productGUID := range recipes {
			sort.Slice(recipes[productGUID], func(i, j int) bool {
				return recipes[productGUID][i].Factory < recipes[productGUID][j].Factory
			})
		}
		guidList := make([]int32, 0, len(recipes))
		for guid := range recipes {
			guidList = append(guidList, guid)
		}
		sort.Slice(guidList, func(i, j int) bool { return guidList[i] < guidList[j] })

		expand := func(guid int32, stack map[int32]bool) ([][]stage, error) {
			return expandProduct(guid, recipes, stack)
		}
		for _, productGUID := range guidList {
			for _, targetRecipe := range recipes[productGUID] {
				if len(targetRecipe.Inputs) == 0 {
					continue
				}
				paths, err := expandInputs(targetRecipe.Inputs, expand, map[int32]bool{productGUID: true})
				if err != nil {
					return output{}, fmt.Errorf("region %s product %d: %w", regionName, productGUID, err)
				}
				for _, path := range paths {
					path = append(append([]stage(nil), path...), toStage(targetRecipe))
					result.Regions[regionName] = append(result.Regions[regionName], chain{
						Product: good{GUID: productGUID},
						Stages:  path,
					})
				}
			}
		}
		if len(result.Regions[regionName]) == 0 {
			delete(result.Regions, regionName)
		}
	}
	return result, nil
}

func expandProduct(guid int32, recipes map[int32][]recipe, stack map[int32]bool) ([][]stage, error) {
	var producers []recipe
	for _, candidate := range recipes[guid] {
		if len(candidate.Inputs) > 0 {
			producers = append(producers, candidate)
		}
	}
	if len(producers) == 0 {
		return [][]stage{{}}, nil
	}
	if stack[guid] {
		return nil, fmt.Errorf("production cycle includes product %d", guid)
	}
	stack[guid] = true
	defer delete(stack, guid)

	var paths [][]stage
	for _, producer := range producers {
		inputPaths, err := expandInputs(producer.Inputs, func(input int32, nextStack map[int32]bool) ([][]stage, error) {
			return expandProduct(input, recipes, nextStack)
		}, stack)
		if err != nil {
			return nil, err
		}
		for _, path := range inputPaths {
			paths = append(paths, append(path, toStage(producer)))
		}
	}
	return paths, nil
}

func expandInputs(
	inputs []int32,
	expand func(int32, map[int32]bool) ([][]stage, error),
	stack map[int32]bool,
) ([][]stage, error) {
	paths := [][]stage{{}}
	for _, input := range inputs {
		options, err := expand(input, stack)
		if err != nil {
			return nil, err
		}
		combined := make([][]stage, 0, len(paths)*len(options))
		for _, prefix := range paths {
			for _, option := range options {
				merged := append([]stage(nil), prefix...)
				combined = append(combined, appendUniqueStages(merged, option))
			}
		}
		paths = combined
	}
	return paths, nil
}

func toStage(value recipe) stage {
	inputs := make([]good, len(value.Inputs))
	for index, guid := range value.Inputs {
		inputs[index] = good{GUID: guid}
	}
	return stage{Inputs: inputs, Output: good{GUID: value.Output}}
}

func appendUniqueStages(existing []stage, additions []stage) []stage {
	seen := make(map[string]bool, len(existing))
	for _, item := range existing {
		seen[fmt.Sprintf("%d:%v", item.Output.GUID, item.Inputs)] = true
	}
	for _, item := range additions {
		key := fmt.Sprintf("%d:%v", item.Output.GUID, item.Inputs)
		if !seen[key] {
			existing = append(existing, item)
			seen[key] = true
		}
	}
	return existing
}
