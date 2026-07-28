package main

// Niral Go runner — the Go side of NBP (Niral Backend Protocol).
//
// Speaks newline-delimited JSON over stdio:
//   req:  {"id":1,"fn":"roll","args":[..],"session":{..}}
//   res:  {"id":1,"ok":true,"result":..,"session":{..}|null}
//
// Unlike the Python/Ruby runners (which eval the server block at runtime),
// Go is compiled: the framework materializes a package containing
//   server.go    — the user's <server lang="go"> block (package main)
//   registry.go  — GENERATED: var __fns = map[string]any{"roll": roll, ...}
//   runner.go    — this file
// and starts it with `go run <dir>`. Arguments are converted to each
// function's parameter types via reflection + JSON round-trip; functions may
// return (T), (T, error), (error) or nothing. Panics become protocol errors.
//
// Ambient session, same as every other Niral backend language:
//   session.Get("key")  session.Get("key", fallback)
//   session.Set("key", v)  session.Delete("key")  session.Clear()

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
)

type niralSession struct {
	data  map[string]any
	dirty bool
}

func (s *niralSession) Get(key string, def ...any) any {
	if v, ok := s.data[key]; ok {
		return v
	}
	if len(def) > 0 {
		return def[0]
	}
	return nil
}
func (s *niralSession) Set(key string, val any) { s.data[key] = val; s.dirty = true }
func (s *niralSession) Delete(key string)       { delete(s.data, key); s.dirty = true }
func (s *niralSession) Clear()                  { s.data = map[string]any{}; s.dirty = true }

var session = &niralSession{data: map[string]any{}}

var __out = bufio.NewWriter(os.Stdout)

// publish fans out to a live channel (out-of-band NBP line).
func publish(channel string, data any) {
	b, err := json.Marshal(map[string]any{"publish": map[string]any{"channel": channel, "data": data}})
	if err != nil {
		return
	}
	__out.Write(b)
	__out.WriteByte('\n')
	__out.Flush()
}

// user returns the logged-in identity from the ambient session (nil = anonymous).
func user() any {
	return session.Get("user")
}

type nbpReq struct {
	Id      int               `json:"id"`
	Fn      string            `json:"fn"`
	Args    []json.RawMessage `json:"args"`
	Session map[string]any    `json:"session"`
}

func respond(w *bufio.Writer, id int, ok bool, result any, errMsg string, errKind string, sess any) {
	res := map[string]any{"id": id, "ok": ok, "session": sess}
	if ok {
		res["result"] = result
	} else {
		res["error"] = errMsg
		if errKind != "" {
			res["errorKind"] = errKind
		}
	}
	b, err := json.Marshal(res)
	if err != nil {
		b, _ = json.Marshal(map[string]any{
			"id": id, "ok": false, "session": sess,
			"error": "result is not JSON-serializable: " + err.Error(),
		})
	}
	w.Write(b)
	w.WriteByte('\n')
	w.Flush()
}

func call(fn any, args []json.RawMessage) (out any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()
	v := reflect.ValueOf(fn)
	t := v.Type()
	if t.Kind() != reflect.Func {
		return nil, fmt.Errorf("not a function")
	}
	if t.IsVariadic() {
		return nil, fmt.Errorf("variadic server functions are not supported")
	}
	in := make([]reflect.Value, t.NumIn())
	for i := 0; i < t.NumIn(); i++ {
		pv := reflect.New(t.In(i))
		raw := json.RawMessage("null")
		if i < len(args) {
			raw = args[i]
		}
		if e := json.Unmarshal(raw, pv.Interface()); e != nil {
			return nil, fmt.Errorf("argument %d: cannot convert to %s: %v", i+1, t.In(i), e)
		}
		in[i] = pv.Elem()
	}
	res := v.Call(in)
	switch len(res) {
	case 0:
		return nil, nil
	case 1:
		if e, ok := res[0].Interface().(error); ok {
			return nil, e
		}
		return res[0].Interface(), nil
	case 2:
		if e, ok := res[1].Interface().(error); ok && e != nil {
			return nil, e
		}
		return res[0].Interface(), nil
	}
	return nil, fmt.Errorf("server functions may return at most (value, error)")
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	w := __out
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var req nbpReq
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		session.data = req.Session
		if session.data == nil {
			session.data = map[string]any{}
		}
		session.dirty = false

		fn, ok := __fns[req.Fn]
		if !ok {
			respond(w, req.Id, false, nil, "unknown server function '"+req.Fn+"'", "unknown_fn", nil)
			continue
		}
		result, err := call(fn, req.Args)
		var sessOut any
		if session.dirty {
			sessOut = session.data
		}
		if err != nil {
			respond(w, req.Id, false, nil, err.Error(), "", sessOut)
		} else {
			respond(w, req.Id, true, result, "", "", sessOut)
		}
	}
}
