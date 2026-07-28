import { label } from "../utils.ts"

export default function Home() {
  let text = $state("")
  let todos = $state([{ id: 1, text: "try jsx" }])
  let next = $state(2)

  function add() {
    if (!text.trim()) return
    todos = [...todos, { id: next, text }]
    next = next + 1
    text = ""
  }

  return (
    <div className="app">
      <h1 id="title">Todos — {label(todos.length)}</h1>
      <input id="inp" bind:value={text} placeholder="what next?" />
      <button id="add" onClick={add}>Add</button>
      {todos.length > 3 ? <p id="many">that's a lot</p> : <p id="few">keep going</p>}
      {todos.length > 0 && <ul id="list">{todos.map((t) => <li key={t.id}>{t.text}</li>)}</ul>}
    </div>
  )
}
